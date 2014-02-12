var assert = require("assert");
var express = require("express");

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