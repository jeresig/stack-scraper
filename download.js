try {
    var site = require("./js/site");
} catch(e) {
    var site = require("../js/site");
}

var fs = require("fs"),
    cp = require("child_process"),
    url = require("url"),
    assert = require("assert"),
    util = require("util"),
    rmdir = require("rimraf"),
    _ = require("lodash"),
    async = require("async"),
    mongoose = require("mongoose"),
    request = require("request"),
    libxml = require("libxmljs"),
    Spooky = require("spooky"),
    sprintf = require("util").format,
    express = require("express"),
    Iconv  = require("iconv").Iconv,
    romajiName = require("romaji-name"),
    ArgumentParser = require("argparse").ArgumentParser,
    profile = require("nodetime"),
    argparser = new ArgumentParser({
        description: "Download Scraper",
        addHelp: true,
        version: "0.0.1"
    }),
    source;

// Load models
require("ukiyoe-models")(mongoose);

// Expose this for use by scrapers
site.romajiName = romajiName;

/* TODO PERF:
 * - Switch from using *Sync methods in so many places
 * - Don't do XML file copying/conversion if they already exist
 * - Frontload reading in all XML files.
 * - Switch to using multiple threads for XML processing.
 */

argparser.addArgument(["--site"], {
    help: "The name of the site to download, for example 'ndl'."
});

argparser.addArgument(["--type"], {
    defaultValue: "sources",
    help: "..."
});

argparser.addArgument(["--dryrun"], {
    action: "storeTrue",
    help: "Test downloading of a search page and a result page."
});

argparser.addArgument(["--runtests"], {
    action: "storeTrue",
    help: "Run tests."
});

argparser.addArgument(["--saveresults"], {
    action: "storeTrue",
    help: "Save the test results."
});

argparser.addArgument(["--sleep"], {
    defaultValue: 0,
    help: "How long to wait in-between requests."
});

argparser.addArgument(["--merge"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--update"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--process"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--scrape"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--reset"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--debug"], {
    action: "storeTrue",
    help: "..."
});

argparser.addArgument(["--import"], {
    action: "storeTrue",
    help: "..."
});

var args = argparser.parseArgs();

if (args.debug) {
    profile.profile({
        accountKey: 'd271d5db50012b55fd9efc6f7db8b4d8d542efcf',
        appName: 'Node.js Application'
    });
}

var curSchema = mongoose.model(({
    sources: "ExtractedImage",
    artists: "Bio"
})[args.type]);

var scraper;
var source;
var extractQueue;
var curSite;

var initSite = function(siteName, callback) {
    curSite = siteName;
    extractQueue = [];

    // Load in the scraper file
    var scraperDir = site.env.resolve("../scrape/scrapers/" +
        args.type + "/");
    var scraperFile = scraperDir + "/" + siteName + ".js";

    if (!siteName || !site.env.exists(scraperFile)) {
        console.log("Error: Invalid site name: " + siteName);
        return process.nextTick(callback);
    }

    var time = profile.time("scrape", "Site Init");

    console.log("Processing: " + siteName);

    // We're going to be working in the test directory, when testing
    site.dryrun = !!args.dryrun;

    // Figure out all the working directories
    site.dirs = { base: site.dataDir(args.type + "/" + siteName) };

    // Clean out the old test directory
    if (site.dryrun || args.runtests) {
        rmdir.sync(site.dirs.base);
    }

    // Make sure the base working directories exists
    site.env.mkdir(site.dataDir());
    site.env.mkdir(site.dirs.base);

    // Build the correct paths
    ["pages", "xml", "images", "thumbs", "scaled"].forEach(function(name) {
        site.dirs[name] = site.dataDir(args.type + "/" + siteName, name) + "/";

        // Create the directories if they don't exist
        site.env.mkdir(site.dirs[name]);
    });

    site.dirs.mirror = site.dataDir(args.type + "/" + siteName, "mirror") + "/";

    scraper = require(scraperFile);

    if (typeof scraper === "function") {
        scraper = scraper(site);
    }

    if (args.runtests) {
        if (scraper.type === "server") {
            var staticDir = __dirname + "/tests/" + scraper.source;
            var app = express.createServer();

            var errors = 0;

            // Used to make sure that simple redirects are handled
            app.get("/redirect/:page", function(req, res) {
                errors += 1;
                if (errors >= 2) {
                    res.redirect("/" + req.params.page);
                } else {
                    res.send(500);
                }
            });

            // Used to make sure that complex, slow, redirects work
            app.get("/redirect1/:page", function(req, res) {
                setTimeout(function() {
                    res.redirect("/redirect2/" + req.params.page);
                }, 6000);
            });
            app.get("/redirect2/:page", function(req, res) {
                setTimeout(function() {
                    res.redirect("/" + req.params.page);
                }, 6000);
            });

            // Delay the load of an individual page
            app.get("/page4.html", function(req, res) {
                setTimeout(function() {
                    fs.readFile(staticDir + "/page4.html", function(err, data) {
                        res.header("Content-type", "text/html");
                        res.send(data);
                    });
                }, 6000);
            });

            // Load everything else statically
            app.use("/", express.static(staticDir));

            app.listen(9876);
        }
        // TODO: Handle Mirror
    }

    mongoose.model("Source").findById(siteName, function(err, _source) {
        if (err) {
            time && time.end();
            return callback(err);
        }

        if (!_source) {
            source = new mongoose.model("Source")({
                _id: siteName,
                name: siteName
            });

            source.save(function(err) {
                time && time.end();
                if (err) {
                    callback(err);
                } else {
                    start(callback);
                }
            });
        } else {
            time && time.end();
            source = _source;
            start(callback);
        }
    });
};

var genTmpFile = function() {
    return "/tmp/" + (new Date).getTime() + "" + Math.random();
};

var saveImage = function(baseURL, imageURL, callback) {
    imageURL = url.resolve(baseURL, imageURL);

    var resultHandler = function(err, md5) {
        callback(err, {
            imageURL: imageURL,
            imageName: md5
        });
    };

    if (imageURL.indexOf("http") === 0) {
        site.images.download(imageURL, site.dirs.base, resultHandler);
    } else {
        // Handle a file differently, skip the download
        site.images.processImage(imageURL, site.dirs.base, resultHandler);
    }
};

var saveRecord = function(data, callback) {
    data.source = data.source || source;
    data.modified = Date.now();

    curSchema.create(data, function(err, item) {
        if (!err) {
            console.log("Saved (%s) %s", source._id,
                args.debug ? JSON.stringify(item) : item.imageName);
        }

        callback(err);
    });
};

var updateRecord = function(item, data, callback) {
    if (args.debug) {
        console.log("Updating...");
    }

    _.extend(item, data);

    var delta = item.$__delta();

    if (delta) {
        item.source = item.source || source;
        item.modified = Date.now();
        item.save(function(err) {
            if (!err) {
                console.log("Updated (%s/%s) %s", source._id, item._id,
                    JSON.stringify(delta));
            }

            callback(err);
        });

    } else {
        console.log("No Change (%s/%s) %s", source._id, item._id,
            args.debugs ? JSON.stringify(item) : "");

        process.nextTick(callback);
    }
};

var saveData = function(data, callback) {
    var time = profile.time("scrape", "Save Data");
    if (data._id) {
        curSchema.findById(data._id, function(err, item) {
            if (err) {
                callback(err);
                return;
            }

            updateRecord(item, data, function(err, data) {
                time && time.end();
                callback(err, data);
            });
        });
    } else {
        saveRecord(data, callback);
    }
};

var convertXML = function(name, callback) {
    var htmlFile = site.dirs.pages + name + ".html";
    var xmlFile = site.dirs.xml + name + ".xml";
    var encoding = "";

    if (fs.existsSync(xmlFile)) {
        return process.nextTick(callback);
    }

    var time = profile.time("scrape", "Convert XML");

    fs.readFile(htmlFile, function(err, html) {
        if (scraper.encoding) {
            html = (new Iconv(scraper.encoding, "UTF-8"))
                .convert(html);
        }

        var tidy = cp.spawn("tidy", [
            "-utf8",
            "-asxml",
            "--hide-comments", "yes",
            "--add-xml-decl", "yes",
            "--doctype", "transitional",
            "--show-warnings", "0",
            "--force-output", "yes"
        ]);

        tidy.stdout
            .pipe(fs.createWriteStream(xmlFile))
            .on("close", function() {
                fs.stat(xmlFile, function(err, stats) {
                    // UGH. Sometimes, haven't figured out why yet, tidy
                    // just kicks the bucket and outputs the default empty file.
                    // We look for this by file size and try again.
                    // TODO: Find a sane solution to this.
                    if (stats.size === 369) {
                        if (args.debug) {
                            console.log("Error: Tidy Failed");
                        }

                        fs.unlink(xmlFile, function() {
                            // TODO: What if it's an actual empty file?
                            // We probably shouldn't recurse forever.
                            convertXML(name, callback);
                        });
                    } else {
                        time && time.end();
                        callback();
                    }
                });
            });

        tidy.stdin.write(html);
        tidy.stdin.end();
    });
};

var processSite = function(callback) {
    curSchema.find({ source: curSite, extracted: true }).exec(function(err, datas) {
        if (err) {
            callback(err);
        } else {
            async.eachLimit(datas, 1, function(data, callback) {
                postProcess(data, function() {
                    updateRecord(data, {}, callback);
                });
            }, callback);
        }
    });
};

var applyChange = function(schemaName, obj, prop, data) {
    var value = obj[prop];

    if (typeof value !== typeof data) {
        obj[prop] = data;
        return;
    }

    var schema = mongoose.model(schemaName);

    for (var key in value) {
        if (value.hasOwnProperty(key) && key in schema &&
                data[key] !== value[key]) {
            value[key] = data[key];
        }
    }
};

var postProcess = function(data, callback) {
    var time = profile.time("scrape", "Post Process");

    var fns = _.keys(postProcessors);

    async.reduce(fns, [data], function(datas, processorName, callback) {
        var processor = postProcessors[processorName];
        async.map(datas, function(data, callback) {
            if (!data[processorName]) {
                return callback(null, data);
            }
            processor(data, scraper, callback);
        }, function(err, datas) {
            callback(err, _.flatten(datas));
        });
    }, function(err, datas) {
        time && time.end();
        if (err) {
            callback(err);
        } else {
            callback(null, datas);
        }
    });
};

var nameCache = {};

var lookupName = function(name, options) {
    if (name in nameCache) {
        return nameCache[name];
    }

    var results = romajiName.parseName(name, options);
    nameCache[name] = results;
    return results;
};

var correctNames = function(key) {
    return function(data, scraper, callback) {
        if (_.isArray(data[key])) {
            data[key].forEach(function(name, i) {
                applyChange("Name", data[key], i,
                    lookupName(name, scraper.nameOptions));
            });
        } else {
            applyChange("Name", data, key,
                lookupName(data[key], scraper.nameOptions));
        }

        process.nextTick(function() { callback(null, data); });
    };
};

var postProcessors = {
    // Artist
    "name": correctNames("name"),
    "aliases": correctNames("aliases"),

    // Image
    "artists": correctNames("artists"),
    "publisher": correctNames("publisher"),
    "carver": correctNames("publisher"),
    "depicted": correctNames("depicted"),

    "images": function(data, scraper, callback) {
        async.map(data.images, function(image, callback) {
            saveImage(data.url, image, callback);
        }, function(err, imageDatas) {
            if (err) {
                return callback(err);
            }

            var related = _.pluck(imageDatas, "imageName");

            callback(null, imageDatas.map(function(imageData) {
                return _.extend({}, data, imageData, {
                    related: _.without(related, imageData.imageName)
                });
            }));
        });
    }
};

var handlers = {
    "savedPage": function(datas, callback) {
        async.map(datas, function(data, callback) {
            if (!data.savedPage) {
                return callback(null, data);
            }

            site.env.md5(data.savedPage, function(md5) {
                var fileName = md5 + ".html";
                var htmlFile = site.dirs.pages + fileName;

                data.pageID = md5;

                if (!fs.existsSync(htmlFile)) {
                    site.env.copyFile(data.savedPage, htmlFile);
                }

                convertXML(md5, function(err) {
                    callback(err, data);
                });
            });
        }, callback);
    },

    "extract": function(datas, callback) {
        callback(null, datas.map(function(data) {
            if (data.extract && data.extract[data.queuePos]) {
                // Make sure the queue is as least as long as it should be
                for (var i = extractQueue.length; i < data.queuePos; i++) {
                    extractQueue[i] = null;
                }

                // Inject into position and delete everything after this point
                // in the queue.
                extractQueue.splice(data.queuePos, extractQueue.length,
                    data.pageID);
                data.extract = _.map(extractQueue.slice(0), function(item) {
                    return item || "";
                });
                data.extracted = true;
            } else {
                delete data.extract;
                delete data.extracted;
            }

            delete data.queuePos;

            return data;
        }));
    }
};

var startCasper = function(callback) {
    console.log("Starting CasperJS...");

    var processQueue = async.queue(function(data, next) {
        // If the dummy boolean is hit then we're all done processing!
        if (data === true) {
            next();
            callback();

        } else {
            // Otherwise we need to keep processing the data
            processData(data, next);
        }
    }, 1);

    var options = _.clone(args);
    options.site = curSite;

    var settings = _.extend({
        loadImages: false,
        javascriptEnabled: true,
        loadPlugins: false,
        timeout: 30000,
        stepTimeout: 30000,
        waitTimeout: 30000
    }, scraper.pageSettings);

    var spooky = new Spooky({
        exec: {
            file: "download-casper.js",
            options: options
        },
        casper: {
            logLevel: args.debug ? "debug" : "error",
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
        if (args.debug) {
            console.log(log.message.replace(/ \- .*/, ""));
        }
    });

    spooky.on("data", function(data) {
        processQueue.push(data);
    });

    spooky.on("done", function() {
        // Push on a dummy boolean to know when we've hit the end of the queue
        processQueue.push(true);
    });
};

var extract = function(xmlDoc, selectors, data, accept) {
    if (typeof selectors === "function") {
        selectors(data, xmlDoc);

    } else {
        for (var prop in selectors) {
            var type = selectors[prop],
                fixedProp = prop.replace(/\[\]/, ""),
                multi = prop !== fixedProp,
                val;

            if (typeof type === "string") {
                val = snag(xmlDoc, data, multi, type);
            } else if (typeof type === "function") {
                val = type(data);
            } else if (typeof type === "boolean") {
                val = type;
            } else {
                val = snag.apply(null,
                    [xmlDoc, data, multi].concat(type));
            }

            if (val != null) {
                data[fixedProp] = val;
            }
        }
    }
};

var snag = function(xmlDoc, data, multi, selector, process) {
    var ret;

    selector.split(/\s*\|\|\s*/).forEach(function(selector) {
        if (ret != null) {
            return;
        }

        var texts = getAllText(xmlDoc, cssToXPath(selector));

        if (texts.length > 0) {
            ret = multi ?
                texts :
                texts.join(" ");
        }
    });

    if (typeof ret === "string") {
        ret = getValue(ret, data, process) || undefined;

    } else if (ret) {
        ret = ret.map(function(val) {
            return getValue(val, data, process);
        }).filter(function(val) {
            return val || undefined;
        });
    }

    return ret;
};

var cssToXPath = function(selector) {
    return selector
        .replace(/#([\w_-]+)/g, "[@id='$1']")
        .replace(/\.([\w_-]+)(\/|\[| |$)/g,
            "[contains(@class,'$1')]$2")
        .replace(/^([^.\/])/, "//$1")
        .replace(/\/\[/g, "/*[");
};

var getValue = function(val, data, process) {
    val = val.trim();

    if (process) {
        val = process(val, data) || "";
    }

    return !val || val instanceof Array ?
        val :
        String(val).trim().replace(/\s+/g, " ");
};

var getText = function(node) {
    var text = "";

    if (node.nodeType === 1) {
        var childNodes = node.childNodes;
        for (var i = 0, l = childNodes.length; i < l; i++) {
            text += getText(childNodes[i]);
        }
    } else {
        text += node.nodeValue;
    }

    return text;
};

var getAllText = function(xmlDoc, selector) {
    var results = xmlDoc.find(selector.path || selector);

    return (results || []).map(function(item) {
        return item.text ? item.text() : item.value();
    });
};

var processDoc = function(data, callback) {
    var time = profile.time("scrape", "Process Doc");
    var datas = [data];

    scraper.scrape.forEach(function(queueLevel, queuePos) {
        datas = _.flatten(datas.map(function(data) {
            var pageID = data && data.extract && data.extract[queuePos];

            if (!pageID) {
                return [data];
            }

            if (typeof queueLevel.extract === "function") {
                extract(null, queueLevel.extract, data);
                return [data];
            }

            var xmlFile = site.dirs.xml + pageID + ".xml";

            if (fs.existsSync(xmlFile)) {
                var xmlData = fs.readFileSync(xmlFile, "utf8");

                // Strip out XMLNS to make XPath queries sane
                xmlData = xmlData.replace(/xmlns=\s*".*?"/g, "");

                // TODO: Catch any errors when parsing the XML
                var xmlDoc = libxml.parseXml(xmlData);

                if (queueLevel.root) {
                    var roots = xmlDoc.find(queueLevel.root);
                    return roots.map(function(root) {
                        var clonedData = _.cloneDeep(data);
                        extract(root, queueLevel.extract, clonedData);
                        return clonedData;
                    });
                } else {
                    extract(xmlDoc, queueLevel.extract, data);
                    return [data];
                }
            }
        }));
    });

    async.forEach(datas, function(data, callback) {
        if (data && (!scraper.accept || scraper.accept(data))) {
            postProcess(data, function(err, datas) {
                if (err) {
                    callback(err);
                } else {
                    async.forEach(datas, saveData, callback);
                }
            });
        } else {
            callback();
        }
    }, function(err, data) {
        time && time.end();
        callback(err, data);
    });
};

var processData = function(data, callback) {
    var time = profile.time("scrape", "Process Data");
    // TODO: Only run method if property exists on data
    var fns = _.values(handlers);
    async.reduce(fns, [data], function(datas, handler, callback) {
        handler(datas, callback);
    }, function(err, datas) {
        time && time.end();
        if (err) {
            callback(err);
        } else {
            async.forEach(datas, processDoc, callback);
        }
    });
};

/*
 * TODO: Figure out where this error is coming from:
 * { [Error: Child terminated with non-zero exit code 1] details: { code: 1, signal: null } }
 */

var scrapeSite = function(callback) {
    curSchema.find({ source: curSite, extracted: true }).exec(function(err, datas) {
        if (err) {
            callback(err);
        } else {
            async.eachLimit(datas, 1, processDoc, callback);
        }
    });
};

var scrapeFromMirror = function(dir, callback) {
    var exclude = [".jpg", ".jpeg", ".png", ".gif"];
    var queue = [];

    var readdir = function(dir) {
        // site.dirs.mirror
        fs.readdirSync(dir).forEach(function(file) {
            file = dir + file;
            if (fs.statSync(file).isDirectory()) {
                readdir(file);
            } else {
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
            }
        });
    };

    readdir(dir);

    async.eachLimit(queue, 1, processData, callback);
};

var cleanTestResults = function(datas) {
    return datas.map(function(item) {
        var result = _.omit(item, ["_id", "created", "modified"]);
        if (result.artists) {
            result.artists = result.artists.map(function(artist) {
                return _.omit(artist, "_id");
            });
        }
        return result;
    }).sort(function(a, b) {
        return a.pageID.localeCompare(b.pageID);
    });
}

var compareTestData = function(actual, expected, callback) {
    actual = cleanTestResults(actual);
    expected = cleanTestResults(expected);

    assert.equal(actual.length, expected.length, "Equal number of results");

    expected.forEach(function(expectedItem, i) {
        var actualItem = actual[i];

        for (var prop in expectedItem) {
            assert.deepEqual(actualItem[prop], expectedItem[prop],
                util.format("Mis-match of '%s' in: %s %s", prop,
                    JSON.stringify(actualItem),
                    JSON.stringify(expectedItem)));
        }
    });

    callback();
};

var testData = function(callback) {
    var testFile = __dirname + "/tests/" + curSite + ".json";

    fs.readFile(testFile, function(err, testData) {
        if (err && !args.saveresults) {
            console.log("Error loading tests: Re-run with --saveresults");
            return callback();
        }

        curSchema.find({source: curSite}).lean(true).exec(function(err, datas) {
            if (err) {
                callback(err);
            } else {
                if (args.saveresults) {
                    fs.writeFile(testFile, JSON.stringify(datas), callback);
                } else {
                    testData = JSON.parse(testData.toString())
                    compareTestData(datas, testData, callback);
                }
            }
        });
    });
};

var resetSource = function(callback, complete) {
    // Wipe out site log before beginning
    curSchema.remove({source: curSite}, function(err) {
        if (err) {
            callback(err);
            return;
        }

        complete(callback);
    });
};

var importOldSite = function(callback) {
    var dataJSONFile = site.baseDataDir() + args.type + "/" +
        curSite + "/data.json";

    nameCache = {};

    if (!fs.existsSync(dataJSONFile)) {
        console.log("Old JSON file does not exist: " + dataJSONFile)
        return callback();
    }

    scraper.nameOptions = {
        stripParens: true
    };

    resetSource(callback, function(callback) {
        var datas = JSON.parse(fs.readFileSync(dataJSONFile, "utf8"));

        async.eachLimit(datas, 10, function(data, callback) {
            if (!data) {
                return callback();
            }

            var newData = {
                extract: ["", data.source_id],
                extracted: true,
                imageURL: data.source_image,
                imageName: data.image_file.replace(/.jpg$/, ""),
                pageID: data.source_id,
                url: data.source_url,
                //lang: "en", // TODO: Fix this.
                artists: data.artist ? [data.artist] : [],
                title: data.title,
                description: data.description,
                dateCreated: data.date
            };

            postProcess(newData, function(err, datas) {
                if (err) {
                    return callback(err);
                }

                async.forEach(datas, saveData, callback);
            });
        }, callback);
    });
};

var start = function(callback) {
    if (args.reset) {
        resetSource(callback, callback);
    } else if (args.scrape) {
        scrapeSite(callback);
    } else if (args.process) {
        processSite(callback);
    } else if (args.import) {
        importOldSite(callback);
    } else {
        var startScrape = function() {
            if (fs.existsSync(site.dirs.mirror)) {
                scrapeFromMirror(site.dirs.mirror, callback);
            } else {
                startCasper(callback);
            }
        };

        if (args.update) {
            startScrape();
        } else {
            resetSource(callback, startScrape);
        }
    }
};

console.log("Connecting to MongoDB...");

mongoose.connect('mongodb://localhost/extract');

mongoose.connection.on('error', function(err) {
    console.error('Connection Error:', err)
});

mongoose.connection.once('open', function() {
    console.log("Connected.");

    var callback = function(err) {
        if (err) {
            console.error(err);
        } else {
            console.log("DONE");
        }
        process.exit(0);
    };

    console.log("Loading Name Data...");

    romajiName.init(function() {
        console.log("Loaded.");

        if (args.runtests) {
            var scraperDir = site.env.resolve(__dirname + "/scrapers/" +
                args.type + "/");

            fs.readdir(scraperDir, function(err, sites) {
                sites = sites.filter(function(site) {
                    return site.indexOf("_test.js") >= 0;
                }).map(function(site) {
                    return site.replace(".js", "");
                });

                async.mapLimit(sites, 1, initSite, function(err) {
                    if (err) {
                        return callback(err);
                    }
                    testData(callback);
                });
            });

        } else if (args.merge) {
            mergeArtists(callback);
            return;

        } else if (args.site) {
            if (args.site === "*") {
                fs.readdir(site.baseDataDir() + args.type, function(err, sites) {
                    async.mapLimit(sites, 1, initSite, callback);
                });
            } else {
                initSite(args.site, callback);
            }
        }
    });
});
