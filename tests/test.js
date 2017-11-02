"use strict";

const assert = require("assert");
const util = require("util");
const fs = require("fs");

const express = require("express");
const {ArgumentParser} = require("argparse");
const {omit} = require("lodash");

const cleanTestResults = function(datas) {
    return datas.map((item) => {
        const result = omit(item, ["_id", "created", "modified"]);
        if (result.artists) {
            result.artists = result.artists
                .map((artist) => omit(artist, "_id"));
        }
        return result;
    }).sort((a, b) => a.pageID.localeCompare(b.pageID));
};

const compareTestData = function(actual, expected, callback) {
    actual = cleanTestResults(actual);
    expected = cleanTestResults(expected);

    assert.equal(actual.length, expected.length, "Equal number of results");

    expected.forEach((expectedItem, i) => {
        const actualItem = actual[i];

        for (const prop in expectedItem) {
            assert.deepEqual(actualItem[prop], expectedItem[prop],
                util.format("Mis-match of '%s' in: %s %s", prop,
                    JSON.stringify(actualItem),
                    JSON.stringify(expectedItem)));
        }
    });

    callback();
};

const testData = function(curSite, callback) {
    fs.readFile(scraperDataFile, (err, testData) => {
        if (err && !args.saveresults) {
            console.log("Error loading test data: Re-run with --saveresults");
            return callback();
        }

        curSchema.find({source: curSite}).lean(true).exec((err, datas) => {
            if (err) {
                callback(err);
            } else {
                if (args.saveresults) {
                    fs.writeFile(scraperDataFile,
                        JSON.stringify(datas), callback);
                } else {
                    testData = JSON.parse(testData.toString());
                    compareTestData(datas, testData, callback);
                }
            }
        });
    });
};

const argparser = new ArgumentParser();

argparser.addArgument(["--saveresults"], {
    action: "storeTrue",
    help: "Save the test results.",
});

argparser.addArgument(["scraperTestFile"], {
    help: "The scraper test file to run.",
});

const args = argparser.parseArgs();

const {scraperTestFile} = args;
const scraperDataFile = `${scraperTestFile}on`;

const scraper = require(scraperTestFile)();

if (scraper.type === "server") {
    const staticDir = `${__dirname}/${scraper.source}`;
    const app = express.createServer();

    let errors = 0;

    // Used to make sure that simple redirects are handled
    app.get("/redirect/:page", (req, res) => {
        errors += 1;
        if (errors >= 2) {
            res.redirect(`/${req.params.page}`);
        } else {
            res.send(500);
        }
    });

    // Used to make sure that complex, slow, redirects work
    app.get("/redirect1/:page", (req, res) => {
        setTimeout(() => res.redirect(`/redirect2/${req.params.page}`), 6000);
    });

    app.get("/redirect2/:page", (req, res) => {
        setTimeout(() => res.redirect(`/${req.params.page}`), 6000);
    });

    // Delay the load of an individual page
    app.get("/page4.html", (req, res) => {
        setTimeout(() => {
            fs.readFile(`${staticDir}/page4.html`, (err, data) => {
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

testData(scraper.source, () => {});
