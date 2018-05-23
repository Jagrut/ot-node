const config = require('./Config');
const app = require('http').createServer();
const remote = require('socket.io')(app);
const node = require('./Node');
const Models = require('../models');
const kadence = require('@kadenceproject/kadence');
const pjson = require('../package.json');
const Storage = require('./Storage');
const GraphStorage = require('./GraphStorageInstance');

class RemoteControl {
    static async connect() {
        this.node = node.ot;
        app.listen(config.remote_control_port);
        await remote.on('connection', (socket) => {
            this.socket = socket;
            RemoteControl.getProtocolInfo().then((res) => {
                socket.emit('system', { info: res });
                var config = {};
                Models.node_config.findAll()
                    .then((rows) => {
                        rows.forEach((row) => {
                            config[row.key] = row.value;
                        });
                        socket.emit('config', config);
                    });
            }).then((res) => {
                RemoteControl.updateImports();
            });

            this.socket.on('config-update', (data) => {
                for (var key in data) {
                    Storage.db.query('UPDATE node_config SET value = ? WHERE key = ?', {
                        replacements: [data[key], key],
                    }).then((res) => {
                        setTimeout(() => {
                            process.on('exit', () => {
                                /* eslint-disable-next-line */
                                require('child_process').spawn(process.argv.shift(), process.argv, {
                                    cwd: process.cwd(),
                                    detached: true,
                                    stdio: 'inherit',
                                });
                            });
                            process.exit();
                        }, 5000);
                    }).catch((err) => {
                        console.log(err);
                    });
                }
            });

            this.socket.on('get-imports', () => {
                RemoteControl.updateImports();
            });

            this.socket.on('get-visual-graph', (import_id) => {
                RemoteControl.getImport(import_id);
            });
        });
    }

    /**
     * Returns basic information about the running node
     * @param {Control~getProtocolInfoCallback} callback
     */
    static getProtocolInfo() {
        return new Promise((resolve, reject) => {
            const peers = [];
            const dump = this.node.router.getClosestContactsToKey(
                this.node.identity,
                kadence.constants.K * kadence.constants.B,
            );

            for (const peer of dump) {
                peers.push(peer);
            }

            resolve({
                versions: pjson.version,
                identity: this.node.identity.toString('hex'),
                contact: this.node.contact,
                peers,
            });
        });
    }

    /**
     * Update imports table from data_info
     */
    static updateImports() {
        return new Promise((resolve, reject) => {
            Models.data_info.findAll()
                .then((rows) => {
                    this.socket.emit('imports', rows);
                    resolve();
                });
        });
    }

    /**
     * Get graph by import_id
     * @import_id int
     */
    static getImport(import_id) {
        return new Promise((resolve, reject) => {
            const verticesPromise = GraphStorage.db.findVerticesByImportId(import_id);
            const edgesPromise = GraphStorage.db.findEdgesByImportId(import_id);

            Promise.all([verticesPromise, edgesPromise]).then((values) => {
                var nodes = [];
                var edges = [];
                values[0].forEach((vertex) => {
                    const isRoot = !!((vertex._id === 'ot_vertices/Transport'
                        || vertex._id === 'ot_vertices/Transformation'
                        || vertex._id === 'ot_vertices/Product'
                        || vertex._id === 'ot_vertices/Ownership'
                        || vertex._id === 'ot_vertices/Observation'
                        || vertex._id === 'ot_vertices/Location'
                        || vertex._id === 'ot_vertices/Actor'
                    ));
                    console.log(vertex);
                    nodes.push({
                        id: vertex._id,
                        caption: vertex._id,
                        root: isRoot,
                        // category: vertex.data.category,
                        // description: vertex.data.description,
                        // object_class_id: vertex.data.object_class_id,
                    });
                });
                values[1].forEach((edge) => {
                    console.log(edge);
                    edges.push({
                        source: edge._from,
                        target: edge._to,
                    });
                });

                this.socket.emit('visualise', { nodes, edges });
                resolve();
            });
        });
    }
}

module.exports = RemoteControl;
