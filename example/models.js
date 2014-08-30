var mongoose = require("mongoose");

var DataSchema = mongoose.schema({
    // UUID of the data (Recommended format: SOURCE/UUID)
    _id: String,

    // The date that this item was created
    created: {type: Date, "default": Date.now},

    // The date that this item was updated
    modified: Date,

    // The source of the information (the name of the scraper)
    source: String,

    // UUID of the source page. (Format: PAGEMD5)
    pageID: String,

    // Full URL of the original page from where the data came
    url: String,

    // An array of page IDs from which data was extracted
    extract: [String],

    // Determine if data was actually extracted from the page
    extracted: Boolean
});

mongoose.model("Data", DataSchema)

var ScrapeLogSchema = mongoose.schema({
    // The date that the action started
    startTime: Date,

    // The date that the action completed
    endTime: Date,

    // The type of the data
    type: String,

    // The source of the data
    source: String,

    // The queue level being processed
    level: Number,

    // Options to be passed in to the queue level
    levelOptions: mongoose.schema.Types.Mixed,

    // Data extracted from the page
    data: [mongoose.schema.Types.Mixed],

    // A list of the item ids which were extracted from the page
    extracted: [String],

    // UUID of the page data (Format: PAGEMD5)
    pageID: String,

    // Full URL of the original page from where the data came
    url: String
});

mongoose.model("ScrapeLog", ScrapeLogSchema);