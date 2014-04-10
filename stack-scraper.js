var fs = require("graceful-fs");
var path = require("path");
var util = require("util");

var _ = require("lodash");
var async = require("async");
var Spooky = require("spooky");
var glob = require("glob");
var findit = require("findit");
var request = require("request");

var fileUtils = require("./src/file.js");
var extractUtils = require("./src/extract.js");

var StackScraper = function() {};

StackScraper.prototype = {
    pageSettings: {
        loadImages: false,
        javascriptEnabled: true,
        loadPlugins: false,
        timeout: 30000,
        stepTimeout: 30000,
        waitTimeout: 30000
    },

    mirrorExclude: [".jpg", ".jpeg", ".png", ".gif"],

    init: function(options) {
        this.setupDirs(options);

        this.options = options;
        this.extractQueue = [];

        if (!this.options.model) {
            throw "StackScraper: Please provide a model.";
        }

        if (!this.options.source) {
            throw "StackScraper: Please provide a source name.";
        }

        if (!this.options.scraperFile &&
                !fs.existsSync(this.options.scraperFile)) {
            throw "StackScraper: Please provide a path to a scraper file.";
        }

        if (!this.options.htmlDir && !fs.existsSync(this.options.htmlDir)) {
            throw "StackScraper: Please provide a path to store the HTML " +
                "files in.";
        }

        if (!this.options.xmlDir && !fs.existsSync(this.options.xmlDir)) {
            throw "StackScraper: Please provide a path to store the XML " +
                "files in.";
        }

        this.loadScraperFile(options);
    },

    loadScraperFile: function(options) {
        this.scraper = require(this.options.scraperFile)(options,
            this.mockCasper);
    },

    mockCasper: {
        format: function() {
            return util.format.apply(util, arguments);
        }
    },

    download: function(callback) {
        var queue = [];

        this.dbStreamLog({source: this.options.source})
            .on("data", function(data) {
                var options = {
                    _id: data._id,
                    level: data.level,
                    options: data.levelOptions || {}
                };
                // Don't log if we don't care about the results
                // We do care if we were expecting data but it didn't
                // come out, for some reason.
                if (data.extracted.length > 0 ||
                    !this.scraper.scrape[data.level].extract) {
                    options.options.log = false;
                }
                queue.push(options);
            }.bind(this))
            .on("close", function() {
                queue.forEach(function(cur, i) {
                    if (i >= queue.length - 1 || cur.options.back) {
                        return;
                    }

                    for (var p = i + 1; p < queue.length; p++) {
                        var next = queue[p];
                        if (next.level === cur.level) {
                            if (next.options.back) {
                                delete next.options.back;
                                for (var j = i; j < p; j++) {
                                    queue[j].options.skip = true;
                                }
                            }
                            break;
                        }
                    }
                });

                if (this.options.debug) {
                    console.log("Loading Scrape Queue:");
                    queue.forEach(function(log, i) {
                        if (i > 0 && queue[i - 1].level === log.level) {
                            console.log("SAME", log.level)
                        }
                        console.log(log.level, log._id,
                            JSON.stringify(log.options));
                    });
                }

                this.startCasper(queue, callback);
            }.bind(this));
    },

    startCasper: function(queue, callback) {
        console.log("Starting CasperJS...");

        var processQueue = async.queue(function(data, next) {
            // If the dummy boolean is hit then we're all done processing!
            if (data === true) {
                next();
                callback();

            } else {
                // Otherwise we need to keep processing the data
                this.processData(data, function(err) {
                    if (err) {
                        console.log("ERROR Processing Data:",
                            JSON.stringify(err), JSON.stringify(data));
                    }
                    next();
                });
            }
        }.bind(this), 1);

        var options = _.clone(this.options);

        options.dirname = __dirname;
        options.queue = queue;

        var settings = _.extend(this.pageSettings,
            this.options.pageSettings,
            this.scraper.pageSettings);

        var spooky = new Spooky({
            child: {
                transport: "http"
            },
            exec: {
                file: __dirname + "/src/casper-bootstrap.js",
                options: options
            },
            casper: {
                logLevel: options.debug ? "debug" : "error",
                verbose: true,
                pageSettings: settings,
                exitOnError: false
            }
        });

        spooky.on("error", function(e) {
            console.error(e);
        });

        spooky.on("console", function(line) {
            console.log(line);
        });

        spooky.on("log", function(log) {
            if (options.debug) {
                console.log(log.message.replace(/ \- .*/, ""));
            }
        });

        spooky.on("action", function(data) {
            processQueue.push(data);
        });

        spooky.on("done", function() {
            // Push on a dummy boolean to know when we've hit the
            // end of the queue
            processQueue.push(true);
        });
    },

    scrape: function(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, this.processDoc.bind(this), callback);
        });
    },

    scrapeDirectory: function(dir, callback) {
        if (this.options.debug) {
            console.log("Scraping directory:", dir);
        }

        var queue = [];
        var exclude = this.mirrorExclude.concat(
            this.options.mirrorExclude || []);

        var addFile = function(file) {
            queue.push({
                savedPage: file,
                savedFile: file.replace(dir + "/", ""),
                queuePos: 0,
                extract: [1]
            });
        };

        var done = function() {
            async.eachLimit(queue, 1, this.processData.bind(this), callback);
        }.bind(this);

        if (this.scraper.files) {
            var globs = this.scraper.files;
            if (typeof globs === "string") {
                globs = [globs];
            }

            async.eachLimit(globs, 1, function(globExpr, callback) {
                glob(globExpr, {cwd: dir}, function(err, files) {
                    files.forEach(function(file) {
                        addFile(path.join(dir, file));
                    });
                    callback();
                });
            }, done);
        } else {
            var finder = findit(dir);

            finder.on("file", function(file, stat) {
                // Ignore images
                if (exclude.some(function(ext) {
                    return file.indexOf(ext) >= 0;
                })) {
                    return;
                }

                addFile(file);
            });

            finder.on("end", done);
        }
    },

    scrapeURL: function(url, callback) {
        var tmpFile = "/tmp/" + (new Date).getTime() + Math.random();

        console.log("Downloading %s to %s", url, tmpFile);

        request({
            url: url,
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_2) " +
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/33.0.1750.117 Safari/537.36"
            }
        })
            .pipe(fs.createWriteStream(tmpFile))
            .on("close", function() {
                console.log("Done.");

                var data = {
                    savedPage: tmpFile,
                    queuePos: 0,
                    url: url,
                    extract: []
                };

                this.scraper.scrape.forEach(function(level, pos) {
                    if (level.extract) {
                        data.queuePos = pos;
                        data.extract[pos] = 1;
                    }
                });

                console.log("Adding to queue for processing:", data);

                this.processData(data, callback);
            }.bind(this));
    },

    /*
     * process(filter, callback)
     *
     * Finds all the scraped entries and processes the data according to
     * the processing rules.
     */
    process: function(filter, callback) {
        this.setDataSource(filter);
        this.setDataExtracted(filter);

        this.dbFind(filter, function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, function(data, callback) {
                this.postProcess(data, function(err, datas) {
                    async.eachLimit(datas, 1, function(data, callback) {
                        this.dbUpdate(data, {}, callback);
                    }.bind(this), callback);
                }.bind(this));
            }.bind(this), callback);
        });
    },

    processDoc: function(scrapeData, callback) {
        var datas = [{
            // NOTE: Anything else we need to pass in?
            url: scrapeData.url,
            // Can be used by mirrored pages
            savedPage: scrapeData.savedPage,
            savedFile: scrapeData.savedFile,
            // TODO: Remove the need for this
            extract: scrapeData.extract
        }];

        async.eachLimit(this.scraper.scrape, 1, function(queueLevel, callback) {
            var queuePos = this.scraper.scrape.indexOf(queueLevel);

            async.map(datas, function(data, callback) {
                var pageID = data && data.extract && data.extract[queuePos];

                if (!pageID) {
                    return callback(null, [data]);
                }

                if (typeof queueLevel.extract === "function") {
                    extractUtils.extract(null, queueLevel.extract, data);
                    return callback(null, [data]);
                }

                var xmlFile = path.resolve(this.options.xmlDir,
                    pageID + ".xml");

                fileUtils.readXMLFile(xmlFile, function(err, xmlDoc) {
                    if (xmlDoc.errors && xmlDoc.errors.length > 0) {
                        if (this.options.debug) {
                            console.log("XML Tidy Error:", xmlDoc.errors);
                        }
                    }

                    if (err) {
                        return callback(err || xmlDoc.errors);
                    }

                    if (queueLevel.root) {
                        var roots = xmlDoc.find(queueLevel.root);
                        callback(null, roots.map(function(root) {
                            var clonedData = _.cloneDeep(data);
                            extractUtils.extract(root, queueLevel.extract,
                                clonedData);
                            return clonedData;
                        }));
                    } else {
                        extractUtils.extract(xmlDoc, queueLevel.extract, data);
                        callback(null, [data]);
                    }
                }.bind(this));
            }.bind(this), function(err, _datas) {
                datas = _.flatten(_datas);
                callback(err);
            });
        }.bind(this), function(err) {
            if (err) {
                return callback(err);
            }

            async.eachLimit(datas, 1, function(data, callback) {
                if (!data || this.scraper.accept &&
                        !this.scraper.accept(data)) {
                    if (this.options.debug) {
                        console.log("Rejected:", data);
                    }
                    return callback();
                }

                this.postProcess(data, function(err, datas) {
                    if (datas) {
                        datas = datas.filter(function(data) {
                            var pass = !!(data && data._id);
                            if (data && !pass && this.options.debug) {
                                console.log("Error: Entry does not have _id:", data);
                            }
                            return pass;
                        }.bind(this));

                        scrapeData.data = datas;
                        scrapeData.extracted = datas.map(function(data) {
                            return data._id;
                        });
                    }

                    this.dbLog(scrapeData, function(err) {
                        if (err) {
                            return callback(err);
                        }

                        async.forEach(datas, this.saveData.bind(this),
                            callback);
                    }.bind(this));
                }.bind(this));
            }.bind(this), callback);
        }.bind(this));
    },

    processData: function(data, callback) {
        if (this.options.debug) {
            console.log("Processing:", data.savedPage);
        }

        var fns = _.values(this.processors);
        async.reduce(fns, [data], function(datas, handler, callback) {
            handler.call(this, datas, callback);
        }.bind(this), function(err, datas) {
            if (err) {
                return callback(err);
            }

            async.forEach(datas, this.processDoc.bind(this), callback);
        }.bind(this));
    },

    postProcess: function(data, callback) {
        if (this.options.debug) {
            console.log("Post Processing...");
        }

        var fns = _.keys(this.options.postProcessors || {});

        async.reduce(fns, [data], function(datas, processorName, callback) {
            var processor = this.options.postProcessors[processorName];
            async.map(datas, function(data, callback) {
                if (!data[processorName]) {
                    return callback(null, data);
                }
                processor(data, this.scraper, callback);
            }.bind(this), function(err, datas) {
                callback(err, _.flatten(datas));
            }.bind(this));
        }.bind(this), function(err, datas) {
            if (datas) {
                datas = datas.map(this.enforceTypes.bind(this));
            }

            callback(err, datas);
        }.bind(this));
    },

    types: {
        Array: function(val) {
            return [val];
        },

        Boolean: function(val) {
            return val === "true";
        }
    },

    enforceTypes: function(data) {
        var schema = this.options.model.schema;

        for (var prop in data) {
            var path = schema.path(prop);

            if (!path) {
                continue;
            }

            var pathType = path.options.type;
            var pathName = pathType.name || pathType.constructor.name;
            var typeFn = this.types[pathName];

            if (typeFn) {
                var val = data[prop];

                if (val != null && val.constructor.name !== pathName) {
                    data[prop] = typeFn(val);
                }
            }
        }

        return data;
    },

    saveData: function(data, callback) {
        if (this.options.noSave) {
            var dataModel = new this.options.model(data);
            if (this.options.debug) {
                console.log("Final Data:", dataModel);
            }
            return dataModel.validate(callback);
        }

        if (!data._id) {
            return callback({msg: "No ID specified."});
        }

        this.dbFindById(data._id, function(err, item) {
            delete data.savedPage;

            if (err || !item) {
                this.dbSave(data, callback);
                return;
            }

            this.dbUpdate(item, data, function(err, data) {
                callback(err, data);
            });
        }.bind(this));
    },

    reset: function(filter, callback) {
        this.setDataSource(filter);

        if (this.options.debug) {
            console.log("Resetting.", filter);
        }

        this.dbRemoveLog(filter, callback);
    },

    processors: {
        savedPage: function(datas, callback) {
            var encoding = this.scraper.encoding;

            async.map(datas, function(data, callback) {
                if (!data.savedPage) {
                    return callback(null, data);
                }

                fileUtils.md5File(data.savedPage, function(md5) {
                    var savedPage = data.savedPage;
                    var htmlFile = path.resolve(this.options.htmlDir,
                        md5 + ".html");
                    var xmlFile = path.resolve(this.options.xmlDir,
                        md5 + ".xml");

                    data.pageID = md5;
                    // TODO: Should we ever use this? We should enforce an _id.
                    //data._id = this.options.source + "/" + md5;

                    fileUtils.condCopyFile(savedPage, htmlFile,
                        function() {
                            fileUtils.convertXML(htmlFile, xmlFile, encoding,
                                function(err) {
                                    callback(err, data);
                                });
                        });
                }.bind(this));
            }.bind(this), callback);
        },

        extract: function(datas, callback) {
            var extractQueue = this.extractQueue;

            callback(null, datas.map(function(data) {
                if (!data.extract || !data.extract[data.queuePos]) {
                    delete data.extract;
                    delete data.extracted;
                    delete data.queuePos;
                    return data;
                }

                // Make sure the queue is as least as long as it should be
                for (var i = extractQueue.length; i < data.queuePos; i++) {
                    extractQueue[i] = null;
                }

                // Inject into position and delete everything after this
                // point in the queue.
                extractQueue.splice(data.queuePos, extractQueue.length,
                    data.pageID);
                data.extract = _.map(extractQueue.slice(0), function(item) {
                    return item || "";
                });
                this.setDataExtracted(data);

                delete data.queuePos;

                return data;
            }.bind(this)));
        }
    },

    setDataSource: function(data) {
        var sourceName = this.options.sourceName || "source";
        data[sourceName] = data[sourceName] || this.options.source;
    },

    setDataModified: function(data) {
        data.modified = Date.now();
    },

    setDataExtracted: function(data) {
        data.extracted = true;
    },

    merge: function(orig, source, path) {
        path = path || [];

        for (var prop in source) {
            if (typeof orig[prop] === "object" && orig[prop]) {
                this.merge(orig[prop], source[prop], [prop]);
            } else {
                if (orig[prop] !== source[prop]) {
                    var fullPath = path.concat(prop).join(".");

                    if (this.options.debug) {
                        console.log("Updated:", fullPath, orig[prop],
                            source[prop]);
                    }

                    orig[prop] = source[prop];

                    if (orig.markModified) {
                        orig.markModified(fullPath);
                    }
                }
            }
        }
    },

    dbFind: function(filter, callback) {
        this.options.model.find(filter).exec(callback);
    },

    dbFindById: function(id, callback) {
        if (this.options.debug) {
            console.log("Finding by ID:", id);
        }

        this.options.model.findById(id, callback);
    },

    dbSave: function(data, callback) {
        if (this.options.debug) {
            console.log("Saving...");
            console.log(data);
        }

        this.setDataSource(data);
        this.setDataModified(data);

        var obj = new this.options.model(data);

        obj.save(function(err, item) {
            if (!err) {
                console.log("SAVED (%s) %s", item._id,
                    this.options.debug ? JSON.stringify(item) : "");
            } else {
                console.log("ERROR Saving (%s) %s", data._id,
                    JSON.stringify(data));
                console.log(err)
            }

            callback(err);
        }.bind(this));
    },

    dbUpdate: function(item, data, callback) {
        if (this.options.debug) {
            console.log("Updating...");
        }

        this.merge(item, data);

        var delta = item.$__delta();

        if (delta) {
            this.setDataSource(item);
            this.setDataModified(item);

            item.save(function(err) {
                if (!err) {
                    console.log("Updated (%s) %s", item._id,
                        JSON.stringify(delta));
                }

                callback(err);
            }.bind(this));

        } else {
            console.log("No Change (%s) %s", item._id,
                this.options.debug ? JSON.stringify(item) : "");

            process.nextTick(callback);
        }
    },

    dbRemove: function(filter, callback) {
        this.options.model.remove(filter, callback);
    },

    dbStreamLog: function(filter) {
        return this.options.logModel
            .find(filter)
            .sort({startTime: 1})
            .stream();
    },

    dbRemoveLog: function(filter, callback) {
        this.options.logModel.remove(filter, callback);
    },

    dbLog: function(data, callback) {
        this.setDataSource(data);
        data.type = this.options.model.modelName;

        if (this.options.noSave) {
            var dataModel = new this.options.logModel(data);
            if (this.options.debug) {
                console.log("Log Data:", dataModel);
            }
            return dataModel.validate(callback);
        }

        this.options.logModel.create(data, callback);
    },

    setupDirs: function(args) {
        if (args.rootDataDir && args.type) {
            var dirs = {
                rootDataDir: path.resolve(__dirname, args.rootDataDir)
            };

            dirs.typeDataRoot = path.resolve(dirs.rootDataDir, args.type);
            dirs.sourceDataRoot = path.resolve(dirs.typeDataRoot, args.source);

            dirs.htmlDir = path.resolve(dirs.sourceDataRoot,
                args.htmlDir || "./pages/");
            dirs.xmlDir = path.resolve(dirs.sourceDataRoot,
                args.xmlDir || "./xml/");

            Object.keys(args.directories).forEach(function(dirName) {
                dirs[dirName] = path.resolve(dirs.sourceDataRoot,
                    args.directories[dirName]);
            });

            Object.keys(dirs).forEach(function(dirName) {
                var dir = dirs[dirName];
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir);
                }
            });

            // We don't want to make the mirror directory if it doesn't exist
            dirs.mirrorDir = path.resolve(dirs.sourceDataRoot,
                args.mirrorDir || "./mirror/");

            _.extend(args, dirs);
        }

        if (args.scrapersDir && args.type) {
            args.scrapersDir = path.resolve(__dirname, args.scrapersDir,
                args.type);
            args.scraperFile = path.resolve(args.scrapersDir,
                args.source + ".js");
        }
    },

    run: function(args, callback) {
        if (args.test || args.testURL) {
            this.options.debug = true;
            this.options.noSave = true;
        }

        if (args["delete"]) {
            var filter = {};
            this.setDataSource(filter);

            this.dbRemove(filter, function() {
                this.dbRemoveLog(filter, callback);
            }.bind(this));
        } else if (args.scrape) {
            this.scrape({}, callback);
        } else if (args.process) {
            this.process({}, callback);
        } else if (args.testURL) {
            this.scrapeURL(args.testURL, callback);
        } else {
            var startScrape = function() {
                if (args.mirrorDir && fs.existsSync(args.mirrorDir)) {
                    this.scrapeDirectory(args.mirrorDir, callback);
                } else {
                    this.download(callback);
                }
            }.bind(this);

            if (args.reset) {
                this.reset({}, startScrape);
            } else {
                startScrape();
            }
        }
    }
};

// Bury broken connection errors coming from Spooky/Casper/Phantom
process.on("uncaughtException", function(err) {
    console.error("ERROR", err);
    console.error(err.stack);
}.bind(this));

var cli = function(genOptions, done) {
    var ArgumentParser = require("argparse").ArgumentParser;

    var pkg = require("./package");

    var argparser = new ArgumentParser({
        description: pkg.description,
        version: pkg.version,
        addHelp: true
    });

    argparser.addArgument(["type"], {
        help: "Type of scraper to load (e.g. 'images' or 'artists')."
    });

    argparser.addArgument(["source"], {
        help: "The name of the source to download (e.g. 'ndl' or '*')."
    });

    argparser.addArgument(["--scrape"], {
        action: "storeTrue",
        help: "Scrape and process the results from the already-downloaded " +
            "pages."
    });

    argparser.addArgument(["--process"], {
        action: "storeTrue",
        help: "Process the results from the already-downloaded pages."
    });

    argparser.addArgument(["--reset"], {
        action: "storeTrue",
        help: "Don't resume from where the last scrape left off."
    });

    argparser.addArgument(["--delete"], {
        action: "storeTrue",
        help: "Delete all the data associated with the particular source."
    });

    argparser.addArgument(["--debug"], {
        action: "storeTrue",
        help: "Output additional debugging information."
    });

    argparser.addArgument(["--test-url"], {
        help: "Test extraction against a specified URL.",
        dest: "testURL"
    });

    argparser.addArgument(["--test"], {
        action: "storeTrue",
        help: "Test scraping and extraction of a source."
    });

    var args = argparser.parseArgs();

    var stackScraper = new StackScraper();
    var options = _.extend({}, args);
    options = _.extend(options, genOptions(options, stackScraper));

    var scrapeSource = function(source, callback) {
        console.log("Scraping:", source);
        var scrapeOptions = _.clone(options);
        scrapeOptions.source = source;
        stackScraper.init(scrapeOptions);
        stackScraper.run(scrapeOptions, callback);
    };

    if (options.scrapersDir && args.source === "all") {
        var typeDir = path.resolve(options.scrapersDir, args.type);
        fs.readdir(typeDir, function(err, sources) {
            sources = sources.map(function(source) {
                return /([^\/]+).js$/.exec(source)[1];
            });
            async.eachLimit(sources, 1, scrapeSource, done);
        });
    } else {
        scrapeSource(args.source, done);
    }
};

module.exports = {
    StackScraper: StackScraper,
    cli: cli
};