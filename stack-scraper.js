var fs = require("fs");
var path = require("path");

var _ = require("lodash");
var async = require("async");
var Spooky = require("spooky");
var findit = require("findit");

var fileUtils = require("./src/file.js");
var extractUtils = require("./src/extract.js");

// TODO: Where is the id being generated?
//       Shouldn't it be used as _id?

var StackScraper = function(options) {
    this.options = options;
    this.extractQueue = [];

    if (!this.options.model) {
        throw "StackScraper: Please provide a model.";
    }

    if (!this.options.source) {
        throw "StackScraper: Please provide a source name.";
    }

    if (!this.options.scraperFile && !fs.existsSync(this.options.scraperFile)) {
        throw "StackScraper: Please provide a path to a scraper file.";
    }

    if (!this.options.htmlDir && !fs.existsSync(this.options.htmlDir)) {
        throw "StackScraper: Please provide a path to store the HTML files in.";
    }

    if (!this.options.xmlDir && !fs.existsSync(this.options.xmlDir)) {
        throw "StackScraper: Please provide a path to store the XML files in.";
    }

    this.loadScraperFile();
};

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

    loadScraperFile: function() {
        this.scraper = require(this.options.scraperFile)();
    },

    download: function(callback) {
        console.log("Starting CasperJS...");

        var processQueue = async.queue(function(data, next) {
            // If the dummy boolean is hit then we're all done processing!
            if (data === true) {
                next();
                callback();

            } else {
                // Otherwise we need to keep processing the data
                this.processData(data, next);
            }
        }.bind(this), 1);

        var options = _.clone(this.options);

        var settings = _.extend(this.pageSettings,
            this.options.pageSettings,
            this.scraper.pageSettings);

        var spooky = new Spooky({
            exec: {
                file: __dirName + "/casper-bootstrap.js",
                options: options
            },
            casper: {
                logLevel: options.debug ? "debug" : "error",
                verbose: true,
                pageSettings: settings
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

        spooky.on("data", function(data) {
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

        var finder = findit(dir);

        finder.on("file", function(file, stat) {
            // Ignore images
            if (exclude.some(function(ext) {
                return file.indexOf(ext) >= 0;
            })) {
                return;
            }

            queue.push({
                savedPage: file,
                queuePos: 0,
                extract: [1]
            });
        });

        finder.on("end", function() {
            async.eachLimit(queue, 1, this.processData.bind(this), callback);
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

    processDoc: function(data, callback) {
        var datas = [data];

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

                var xmlFile = path.resolve(this.options.xmlDir, pageID + ".xml");

                fileUtils.readXMLFile(xmlFile, function(err, xmlDoc) {
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
                });
            }.bind(this), function(err, _datas) {
                datas = _.flatten(datas);
                callback();
            });
        }.bind(this), function() {
            async.eachLimit(datas, 1, function(data, callback) {
                if (!data || this.scraper.accept &&
                        !this.scraper.accept(data)) {
                    if (this.options.debug) {
                        console.log("Rejected:", data);
                    }
                    return callback();
                }

                this.postProcess(data, function(err, datas) {
                    if (err) {
                        return callback(err);
                    }

                    async.forEach(datas, this.saveData.bind(this), callback);
                }.bind(this));
            }.bind(this), function(err, data) {
                callback(err, data);
            });
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
        var fns = _.keys(this.options.postProcessors || {});

        async.reduce(fns, [data], function(datas, processorName, callback) {
            var processor = this.options.postProcessors[processorName];
            async.map(datas, function(data, callback) {
                if (!data[processorName]) {
                    return callback(null, data);
                }
                processor(data, this.scraper, callback);
            }.bind(this), function(err, datas) {
                datas = datas.map(this.enforceTypes.bind(this));
                callback(err, _.flatten(datas));
            }.bind(this));
        }.bind(this), callback);
    },

    enforceTypes: function(data) {
        var schema = this.options.model.schema;

        for (var prop in data) {
            var path = schema.path(prop);

            if (!path) {
                continue;
            }

            var pathType = path.options.type;
            if (pathType instanceof Array) {
                // Force the value into an array
                if (!(data[prop] instanceof Array) && data[prop] != null) {
                    data[prop] = [data[prop]];
                }
            }
        }

        return data;
    },

    saveData: function(data, callback) {
        if (!data._id) {
            this.dbSave(data, callback);
            return;
        }

        this.dbFindById(data._id, function(err, item) {
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

        this.dbRemove(filter, callback);
    },

    processors: {
        savedPage: function(datas, callback) {
            var encoding = this.scraper.encoding;

            async.map(datas, function(data, callback) {
                if (!data.savedPage) {
                    return callback(null, data);
                }

                fileUtils.md5File(data.savedPage, function(md5) {
                    var htmlFile = path.resolve(this.options.htmlDir,
                        md5 + ".html");
                    var xmlFile = path.resolve(this.options.xmlDir,
                        md5 + ".xml");

                    data.pageID = md5;
                    data._id = this.options.source + "/" + md5;

                    fileUtils.condCopyFile(data.savedPage, htmlFile,
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

    dbFind: function(filter, callback) {
        this.options.model.find(filter).exec(callback);
    },

    dbFindById: function(id, callback) {
        this.options.model.findById(id, callback);
    },

    dbSave: function(data, callback) {
        this.setDataSource(data);
        this.setDataModified(data);

        var obj = new this.options.model(data);

        obj.save(function(err, item) {
            if (!err) {
                console.log("Saved (%s) %s", this.options.source,
                    this.options.debug ? JSON.stringify(item) : item._id);
            }

            callback(err);
        }.bind(this));
    },

    dbUpdate: function(item, data, callback) {
        if (this.options.debug) {
            console.log("Updating...");
        }

        _.extend(item, data);

        var delta = item.$__delta();

        if (delta) {
            this.setDataSource(item);
            this.setDataModified(item);

            item.save(function(err) {
                if (!err) {
                    console.log("Updated (%s/%s) %s", this.options.source,
                        item._id, JSON.stringify(delta));
                }

                callback(err);
            }.bind(this));

        } else {
            console.log("No Change (%s/%s) %s", this.options.source, item._id,
                this.options.debug ? JSON.stringify(item) : "");

            process.nextTick(callback);
        }
    },

    dbRemove: function(filter, callback) {
        this.options.model.remove(filter, callback);
    }
};

var runScraper = function(args, callback) {
    if (args.rootDataDir && args.type) {
        args.rootDataDir = path.resolve(__dirname, args.rootDataDir);

        var typeDataRoot = path.resolve(args.rootDataDir, args.type);
        var sourceDataRoot = path.resolve(typeDataRoot, args.source);

        args.htmlDir = path.resolve(sourceDataRoot,
            args.htmlDir || "./pages/");
        args.xmlDir = path.resolve(sourceDataRoot,
            args.xmlDir || "./xml/");
        args.mirrorDir = path.resolve(sourceDataRoot,
            args.mirrorDir || "./mirror/");

        var otherDirs = (args.directories || []).map(function(dir) {
            return path.resolve(sourceDataRoot, dir);
        });

        var directories = [
            args.rootDataDir,
            typeDataRoot,
            sourceDataRoot,
            args.htmlDir,
            args.xmlDir
        ].concat(otherDirs);

        directories.forEach(function(dir) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
            }
        });
    }

    if (args.scrapersDir && args.type) {
        args.scrapersDir = path.resolve(__dirname, args.scrapersDir, args.type);
        args.scraperFile = path.resolve(args.scrapersDir, args.source + ".js");
    }

    var stackScraper = new StackScraper(args);

    if (args["delete"]) {
        stackScraper.reset({}, callback);
    } else if (args.scrape) {
        stackScraper.scrape({}, callback);
    } else if (args.process) {
        stackScraper.process({}, callback);
    } else {
        var startScrape = function() {
            if (args.mirrorDir && fs.existsSync(args.mirrorDir)) {
                stackScraper.scrapeDirectory(args.mirrorDir, callback);
            } else {
                stackScraper.download(callback);
            }
        };

        if (args.update) {
            startScrape();
        } else {
            stackScraper.reset({}, startScrape);
        }
    }
};

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
        help: "Scrape and process the results from the already-downloaded pages."
    });

    argparser.addArgument(["--process"], {
        action: "storeTrue",
        help: "Process the results from the already-downloaded pages."
    });

    argparser.addArgument(["--update"], {
        action: "storeTrue",
        help: "Force the existing entries to be updated rather than deleted first."
    });

    argparser.addArgument(["--delete"], {
        action: "storeTrue",
        help: "Delete all the data associated with the particular source."
    });

    argparser.addArgument(["--debug"], {
        action: "storeTrue",
        help: "Output additional debugging information."
    });

    var args = argparser.parseArgs();

    var scrapeSource = function(source, callback) {
        var options = _.extend({}, args, {source: source});
        options = _.extend(options, genOptions(options));
        runScraper(options, callback);
    };

    if (args.source === "*") {
        var typeDir = path.resolve(options.scrapersDir, args.type);
        fs.readdir(typeDir, function(err, sources) {
            async.mapLimit(sources, 1, scrapeSource, done);
        });
    } else {
        scrapeSource(args.source, done);
    }
};

module.exports = {
    StackScraper: StackScraper,
    run: runScraper,
    cli: cli
};