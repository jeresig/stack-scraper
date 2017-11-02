"use strict";

const fs = require("graceful-fs");
const path = require("path");
const util = require("util");

const {cloneDeep, flatten} = require("lodash");
const async = require("async");
const Spooky = require("spooky");
const glob = require("glob");
const findit = require("findit");
const request = require("request");

const fileUtils = require("./src/file.js");
const extractUtils = require("./src/extract.js");

const pageSettings = {
    loadImages: false,
    javascriptEnabled: true,
    loadPlugins: false,
    timeout: 30000,
    stepTimeout: 30000,
    waitTimeout: 30000,
};

const mirrorExclude = [".jpg", ".jpeg", ".png", ".gif"];

const types = {
    Array(val) {
        return [val];
    },

    Boolean(val) {
        return val === "true";
    },
};

const processors = {
    savedPage(datas, callback) {
        const encoding = this.scraper.encoding;

        async.map(datas, (data, callback) => {
            if (!data.savedPage) {
                return callback(null, data);
            }

            fileUtils.md5File(data.savedPage, md5 => {
                const savedPage = data.savedPage;
                const htmlFile = path.resolve(this.options.htmlDir,
                    `${md5}.html`);
                const xmlFile = path.resolve(this.options.xmlDir,
                    `${md5}.xml`);

                data.pageID = md5;
                // TODO: Should we ever use this? We should enforce an _id.
                //data._id = this.options.source + "/" + md5;

                fileUtils.condCopyFile(savedPage, htmlFile,
                    () => {
                        fileUtils.convertXML(htmlFile, xmlFile, encoding,
                            err => {
                                callback(err, data);
                            });
                    });
            });
        }, callback);
    },

    extract(datas, callback) {
        const extractQueue = this.extractQueue;

        callback(null, datas.map(data => {
            if (!data.extract || !data.extract[data.queuePos]) {
                delete data.extract;
                delete data.extracted;
                delete data.queuePos;
                return data;
            }

            // Make sure the queue is as least as long as it should be
            for (let i = extractQueue.length; i < data.queuePos; i++) {
                extractQueue[i] = null;
            }

            // Inject into position and delete everything after this
            // point in the queue.
            extractQueue.splice(data.queuePos, extractQueue.length,
                data.pageID);
            data.extract = extractQueue.slice(0).map(item => item || "");
            this.setDataExtracted(data);

            delete data.queuePos;

            return data;
        }));
    },
};

const mockCasper = {
    format() {
        return util.format(...arguments);
    },
};

class StackScraper {
    constructor(options) {
        this.options = options;
        this.extractQueue = [];

        if (!this.options.model) {
            throw new Error("StackScraper: Please provide a model.");
        }

        if (!this.options.source) {
            throw new Error("StackScraper: Please provide a source name.");
        }

        if (!this.options.scraperFile &&
                !fs.existsSync(this.options.scraperFile)) {
            throw new Error(
                "StackScraper: Please provide a path to a scraper file.");
        }

        if (!this.options.htmlDir && !fs.existsSync(this.options.htmlDir)) {
            throw new Error("StackScraper: Please provide a path to " +
                "store the HTML files in.");
        }

        if (!this.options.xmlDir && !fs.existsSync(this.options.xmlDir)) {
            throw new Error("StackScraper: Please provide a path to " +
                "store the XML files in.");
        }

        this.setupDirs(options);
        this.loadScraperFile(options);
    }

    loadScraperFile(options) {
        this.scraper = require(this.options.scraperFile)(options,
            mockCasper);
    }

    download(callback) {
        const queue = [];

        this.dbStreamLog({source: this.options.source})
            .on("data", data => {
                const options = {
                    _id: data._id,
                    level: data.level,
                    options: data.levelOptions || {},
                };
                // Don't log if we don't care about the results
                // We do care if we were expecting data but it didn't
                // come out, for some reason.
                if (data.extracted.length > 0 ||
                    !this.scraper.scrape[data.level].extract) {
                    options.options.log = false;
                }
                queue.push(options);
            })
            .on("close", () => {
                queue.forEach((cur, i) => {
                    if (i >= queue.length - 1 || cur.options.back) {
                        return;
                    }

                    for (let p = i + 1; p < queue.length; p++) {
                        const next = queue[p];
                        if (next.level === cur.level) {
                            if (next.options.back) {
                                delete next.options.back;
                                for (let j = i; j < p; j++) {
                                    queue[j].options.skip = true;
                                }
                            }
                            break;
                        }
                    }
                });

                if (this.options.debug) {
                    console.log("Loading Scrape Queue:");
                    queue.forEach((log, i) => {
                        if (i > 0 && queue[i - 1].level === log.level) {
                            console.log("SAME", log.level);
                        }
                        console.log(log.level, log._id,
                            JSON.stringify(log.options));
                    });
                }

                this.startCasper(queue, callback);
            });
    }

    startCasper(queue, callback) {
        console.log("Starting CasperJS...");

        const processQueue = async.queue((data, next) => {
            // If the dummy boolean is hit then we're all done processing!
            if (data === true) {
                next();
                callback();

            } else {
                // Otherwise we need to keep processing the data
                this.processData(data, err => {
                    if (err) {
                        console.log("ERROR Processing Data:",
                            JSON.stringify(err), JSON.stringify(data));
                    }
                    next();
                });
            }
        }, 1);

        const options = Object.assign({}, this.options);

        options.dirname = __dirname;
        options.queue = queue;

        const settings = Object.assign(
            pageSettings,
            this.options.pageSettings,
            this.scraper.pageSettings
        );

        const spooky = new Spooky({
            child: {
                transport: "http",
            },

            exec: {
                file: `${__dirname}/src/casper-bootstrap.js`,
                options,
            },

            casper: {
                logLevel: options.debug ? "debug" : "error",
                verbose: true,
                pageSettings: settings,
                exitOnError: false,
            },
        });

        spooky.on("error", e => {
            console.error(e);
        });

        spooky.on("console", line => {
            console.log(line);
        });

        spooky.on("log", log => {
            if (options.debug) {
                console.log(log.message.replace(/ \- .*/, ""));
            }
        });

        spooky.on("action", data => {
            processQueue.push(data);
        });

        spooky.on("done", () => {
            // Push on a dummy boolean to know when we've hit the
            // end of the queue
            processQueue.push(true);
        });
    }

    scrape(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, this.processDoc.bind(this), callback);
        });
    }

    scrapeDirectory(dir, callback) {
        if (this.options.debug) {
            console.log("Scraping directory:", dir);
        }

        const queue = [];
        const exclude = mirrorExclude.concat(
            this.options.mirrorExclude || []);

        const addFile = function(file) {
            queue.push({
                savedPage: file,
                savedFile: file.replace(`${dir}/`, ""),
                queuePos: 0,
                extract: [1],
            });
        };

        const done = () => {
            async.eachLimit(queue, 1, this.processData.bind(this), callback);
        };

        if (this.scraper.files) {
            let globs = this.scraper.files;
            if (typeof globs === "string") {
                globs = [globs];
            }

            async.eachLimit(globs, 1, (globExpr, callback) => {
                glob(globExpr, {cwd: dir}, (err, files) => {
                    files.forEach(file => {
                        addFile(path.join(dir, file));
                    });
                    callback();
                });
            }, done);
        } else {
            const finder = findit(dir);

            finder.on("file", (file, stat) => {
                // Ignore images
                if (exclude.some(ext => file.indexOf(ext) >= 0)) {
                    return;
                }

                addFile(file);
            });

            finder.on("end", done);
        }
    }

    scrapeURL(url, callback) {
        const tmpFile = `/tmp/${(new Date).getTime()}${Math.random()}`;

        console.log("Downloading %s to %s", url, tmpFile);

        request({
            url,

            headers: {
                "User-Agent": 'Mozilla/5.0 (Macintosh; Intel Mac OS X ' +
                    '10_9_2) AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/33.0.1750.117 Safari/537.36',
            },
        })
            .pipe(fs.createWriteStream(tmpFile))
            .on("close", () => {
                console.log("Done.");

                const data = {
                    savedPage: tmpFile,
                    queuePos: 0,
                    url,
                    extract: [],
                };

                this.scraper.scrape.forEach((level, pos) => {
                    if (level.extract) {
                        data.queuePos = pos;
                        data.extract[pos] = 1;
                    }
                });

                console.log("Adding to queue for processing:", data);

                this.processData(data, callback);
            });
    }

    /*
     * process(filter, callback)
     *
     * Finds all the scraped entries and processes the data according to
     * the processing rules.
     */
    process(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, (data, callback) => {
                this.postProcess(data, (err, datas) => {
                    async.eachLimit(datas, 1, (data, callback) => {
                        this.dbUpdate(data, {}, callback);
                    }, callback);
                });
            }, callback);
        });
    }

    processDoc(scrapeData, callback) {
        let datas = [{
            // NOTE: Anything else we need to pass in?
            url: scrapeData.url,

            // Can be used by mirrored pages
            savedPage: scrapeData.savedPage,

            savedFile: scrapeData.savedFile,

            // TODO: Remove the need for this
            extract: scrapeData.extract,
        }];

        async.eachLimit(this.scraper.scrape, 1, (queueLevel, callback) => {
            const queuePos = this.scraper.scrape.indexOf(queueLevel);

            async.map(datas, (data, callback) => {
                const pageID = data && data.extract && data.extract[queuePos];

                if (!pageID) {
                    return callback(null, [data]);
                }

                if (typeof queueLevel.extract === "function") {
                    extractUtils.extract(null, queueLevel.extract, data);
                    return callback(null, [data]);
                }

                const xmlFile = path.resolve(this.options.xmlDir,
                    `${pageID}.xml`);

                fileUtils.readXMLFile(xmlFile, (err, xmlDoc) => {
                    if (xmlDoc.errors && xmlDoc.errors.length > 0) {
                        if (this.options.debug) {
                            console.log("XML Tidy Error:", xmlDoc.errors);
                        }
                    }

                    if (err) {
                        return callback(err || xmlDoc.errors);
                    }

                    if (queueLevel.root) {
                        const roots = xmlDoc.find(queueLevel.root);
                        callback(null, roots.map(root => {
                            const clonedData = cloneDeep(data);
                            extractUtils.extract(root, queueLevel.extract,
                                clonedData);
                            return clonedData;
                        }));
                    } else {
                        extractUtils.extract(xmlDoc, queueLevel.extract, data);
                        callback(null, [data]);
                    }
                });
            }, (err, _datas) => {
                datas = flatten(_datas);
                callback(err);
            });
        }, err => {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, (data, callback) => {
                if (!data || this.scraper.accept &&
                        !this.scraper.accept(data)) {
                    if (this.options.debug) {
                        console.log("Rejected:", data);
                    }
                    return callback();
                }

                this.postProcess(data, (err, datas) => {
                    if (datas) {
                        datas = datas.filter(data => {
                            const pass = !!(data && data._id);
                            if (data && !pass && this.options.debug) {
                                console.log("Error: Entry does not have _id:",
                                    data);
                            }
                            return pass;
                        });

                        scrapeData.data = datas;
                        scrapeData.extracted = datas.map(data => data._id);
                    }

                    this.dbLog(scrapeData, err => {
                        if (err) {
                            return callback(err);
                        }

                        async.forEach(datas, this.saveData.bind(this),
                            callback);
                    });
                });
            }, callback);
        });
    }

    processData(data, callback) {
        if (this.options.debug) {
            console.log("Processing:", data.savedPage);
        }

        const fns = Object.values(processors);
        async.reduce(fns, [data], (datas, handler, callback) => {
            handler.call(this, datas, callback);
        }, (err, datas) => {
            if (err) {
                return callback(err);
            }

            async.forEach(datas, this.processDoc.bind(this), callback);
        });
    }

    postProcess(data, callback) {
        if (this.options.debug) {
            console.log("Post Processing...");
        }

        const fns = Object.keys(this.options.postProcessors || {});

        async.reduce(fns, [data], (datas, processorName, callback) => {
            const processor = this.options.postProcessors[processorName];
            async.map(datas, (data, callback) => {
                if (!data[processorName]) {
                    return callback(null, data);
                }
                processor(data, this.scraper, callback);
            }, (err, datas) => {
                callback(err, flatten(datas));
            });
        }, (err, datas) => {
            if (datas) {
                datas = datas.map(this.enforceTypes.bind(this));
            }

            callback(err, datas);
        });
    }

    enforceTypes(data) {
        const schema = this.options.model.schema;

        for (const prop in data) {
            const path = schema.path(prop);

            if (!path) {
                continue;
            }

            const pathType = path.options.type;
            const pathName = pathType.name || pathType.constructor.name;
            const typeFn = types[pathName];

            if (typeFn) {
                const val = data[prop];

                if (val != null && val.constructor.name !== pathName) {
                    data[prop] = typeFn(val);
                }
            }
        }

        return data;
    }

    saveData(data, callback) {
        if (this.options.noSave) {
            const dataModel = new this.options.model(data);
            if (this.options.debug) {
                console.log("Final Data:", dataModel);
            }
            return dataModel.validate(callback);
        }

        if (!data._id) {
            return callback({msg: "No ID specified."});
        }

        this.dbFindById(data._id, (err, item) => {
            delete data.savedPage;
            delete data.savedFile;

            if (err || !item) {
                this.dbSave(data, callback);
                return;
            }

            this.dbUpdate(item, data, (err, data) => {
                callback(err, data);
            });
        });
    }

    reset(filter, callback) {
        this.setDataSource(filter);

        if (this.options.debug) {
            console.log("Resetting.", filter);
        }

        this.dbRemoveLog(filter, callback);
    }

    setDataSource(data) {
        const sourceName = this.options.sourceName || "source";
        data[sourceName] = data[sourceName] || this.options.source;
    }

    setDataModified(data) {
        data.modified = Date.now();
    }

    setDataExtracted(data) {
        data.extracted = true;
    }

    merge(item, data) {
        const obj = new this.options.model(data).toJSON();
        obj.created = item.created;

        for (const prop in obj) {
            if (obj.hasOwnProperty(prop) && obj[prop] &&
                typeof obj[prop] === "object" && obj[prop].length > 0) {
                obj[prop].forEach((subDoc, i) => {
                    if (item[prop] && item[prop][i]) {
                        subDoc._id = item[prop][i]._id;
                    }
                });
            }
        }

        item.set(obj);
    }

    dbFind(filter, callback) {
        this.options.model.find(filter).exec(callback);
    }

    dbFindById(id, callback) {
        if (this.options.debug) {
            console.log("Finding by ID:", id);
        }

        this.options.model.findById(id, callback);
    }

    dbSave(data, callback) {
        if (this.options.debug) {
            console.log("Saving...");
            console.log(data);
        }

        this.setDataSource(data);
        this.setDataModified(data);

        const obj = new this.options.model(data);

        obj.save((err, item) => {
            if (!err) {
                console.log("SAVED (%s) %s", item._id,
                    this.options.debug ? JSON.stringify(item) : "");
            } else {
                console.log("ERROR Saving (%s) %s", data._id,
                    JSON.stringify(data));
                console.log(err);
            }

            callback(err);
        });
    }

    dbUpdate(item, data, callback) {
        if (this.options.debug) {
            console.log("Updating...");
        }

        this.merge(item, data);

        const delta = item.$__delta();

        if (delta) {
            this.setDataSource(item);
            this.setDataModified(item);

            item.save(err => {
                if (!err) {
                    console.log("Updated (%s) %s", item._id,
                        JSON.stringify(delta));
                }

                callback(err);
            });

        } else {
            console.log("No Change (%s) %s", item._id,
                this.options.debug ? JSON.stringify(item) : "");

            process.nextTick(callback);
        }
    }

    dbRemove(filter, callback) {
        this.options.model.remove(filter, callback);
    }

    dbStreamLog(filter) {
        return this.options.logModel
            .find(filter)
            .sort({startTime: 1})
            .stream();
    }

    dbRemoveLog(filter, callback) {
        this.options.logModel.remove(filter, callback);
    }

    dbLog(data, callback) {
        this.setDataSource(data);
        data.type = this.options.model.modelName;

        if (this.options.noSave) {
            const dataModel = new this.options.logModel(data);
            if (this.options.debug) {
                console.log("Log Data:", dataModel);
            }
            return dataModel.validate(callback);
        }

        this.options.logModel.create(data, callback);
    }

    setupDirs(args) {
        if (args.rootDataDir && args.type) {
            const dirs = {
                rootDataDir: path.resolve(__dirname, args.rootDataDir),
            };

            dirs.typeDataRoot = path.resolve(dirs.rootDataDir, args.type);
            dirs.sourceDataRoot = path.resolve(dirs.typeDataRoot, args.source);

            dirs.htmlDir = path.resolve(dirs.sourceDataRoot,
                args.htmlDir || "./pages/");
            dirs.xmlDir = path.resolve(dirs.sourceDataRoot,
                args.xmlDir || "./xml/");

            Object.keys(args.directories).forEach(dirName => {
                dirs[dirName] = path.resolve(dirs.sourceDataRoot,
                    args.directories[dirName]);
            });

            Object.keys(dirs).forEach(dirName => {
                const dir = dirs[dirName];
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir);
                }
            });

            // We don't want to make the mirror directory if it doesn't exist
            dirs.mirrorDir = path.resolve(dirs.sourceDataRoot,
                args.mirrorDir || "./mirror/");

            Object.assign(args, dirs);
        }

        if (args.scrapersDir && args.type) {
            args.scrapersDir = path.resolve(__dirname, args.scrapersDir,
                args.type);
            args.scraperFile = path.resolve(args.scrapersDir,
                `${args.source}.js`);
        }
    }

    run(args, callback) {
        if (args.test || args.testURL) {
            this.options.debug = true;
            this.options.noSave = true;
        }

        if (args["delete"]) {
            const filter = {};
            this.setDataSource(filter);

            this.dbRemove(filter, () => {
                this.dbRemoveLog(filter, callback);
            });
        } else if (args.scrape) {
            this.scrape({}, callback);
        } else if (args.process) {
            this.process({}, callback);
        } else if (args.testURL) {
            this.scrapeURL(args.testURL, callback);
        } else {
            const startScrape = () => {
                if (args.mirrorDir && fs.existsSync(args.mirrorDir)) {
                    this.scrapeDirectory(args.mirrorDir, callback);
                } else {
                    this.download(callback);
                }
            };

            if (args.reset) {
                this.reset({}, startScrape);
            } else {
                startScrape();
            }
        }
    }
}

module.exports = StackScraper;
