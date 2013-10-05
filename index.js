/*global d3, queue, model */

/* declaration of global object (initialized in setup_vis) */
var VIS = {
    loaded: { }, // which data already loaded?
    ready: { }, // which viz already generated?
    bib_sort: {
        major: "year",
        minor: "alpha"
    },
    overview_words: 15,     // TODO set these parameters interactively
    topic_view_words: 50,
    topic_view_docs: 20,
    doc_view_topics: 10,
    float_format: function (x) {
        return d3.round(x, 3);
    },
    percent_format: d3.format(".1%"),
    cite_date_format: d3.time.format("%B %Y"),
    uri_proxy: ".proxy.libraries.rutgers.edu",
    prefab_plots: true, // use SVG or look for image files for plots?
    plot: {
        w: 640, // TODO hardcoding = bad
        h: 300,
        m: {
            left: 40,
            right: 20,
            top: 20,
            bottom: 20
        },
        bar_width: 300, // in days!
        ticks: 10 // applied to both x and y axes
    }
};

/* declaration of functions */

var doc_sort_key,   // bibliography sorting
    bib_sort,
    topic_label,    // stringifiers
    topic_link,
    cite_doc,
    doc_uri,
    topic_view,     // view generation
    plot_topic_yearly,
    word_view,
    doc_view,
    bib_view,
    about_view,
    model_view,
    view_refresh,
    view_loading,
    setup_vis,      // initialization
    plot_svg,
    read_files,
    main;           // main program


// utility functions
// -----------------

// bibliography sorting

doc_sort_key = function (m, i) {
    var names;
    // TODO shouldn't really combine sort key and extracting the first letter
    // also, this fails when author name ends with Jr, 2nd, (xxx), etc.
    if (m.meta(i).authors.length > 0) {
        names = m.meta(i).authors[0].split(" ");
        return names[names.length - 1][0].toUpperCase(); // N.B. casefolding
    } else {
        return "[Anon]";
    }
};

bib_sort = function (m, major, minor) {
    var result = {
            headings: [],
            docs: []
        },
        docs = d3.range(m.n_docs()),
        major_sort, major_split, minor_sort,
        major_key, cur_major,
        i, last,
        partition = [];

    if (major === "decade") {
        major_split = function (i) {
            return Math.floor(m.meta(i).date.getFullYear() / 10).toString() +
                "0s";
        };

        major_sort = function (a, b) {
            return d3.ascending(+m.meta(a).date, +m.meta(b).date);
        };
    } else if (major === "year") {
        major_split = function (i) {
            return m.meta(i).date.getFullYear();
        };

        major_sort = function (a, b) {
            return d3.ascending(+m.meta(a).date, +m.meta(b).date);
        };
    } else {
        if (major !== "alpha") {
            console.log("Unknown bib_sort: " + major + "; defaulting to alpha");
        }
        // alphabetical
        major_split = function (i) {
            return doc_sort_key(m, i);
        };
        major_sort = function (a, b) {
            return d3.ascending(doc_sort_key(m, a), doc_sort_key(m, b));
        };
    }


    if (minor === "date") {
        minor_sort = function(a, b) {
            return d3.ascending(+m.meta(a).date, +m.meta(b).date);
        };
    } else  {
        if (minor !== "alpha") {
            console.log("Unknown bib_sort: " + minor + "; defaulting to alpha");
        }
        // alphabetical
        minor_sort = function (a, b) {
            return d3.ascending(doc_sort_key(m, a), doc_sort_key(m, b));
        };
    }

    docs = docs.sort(major_sort);
    for (i = 0; i < docs.length; i += 1) {
        major_key = major_split(docs[i]);
        if (major_key !== cur_major) {
            partition.push(i);
            result.headings.push(major_key);
            cur_major = major_key;
        }
    }
    partition.shift(); // correct for "0" always getting added at the start
    partition.push(docs.length); // make sure we get the tail 

    for (i = 0, last = 0; i < partition.length; i += 1) {
        result.docs.push(docs.slice(last, partition[i]).sort(minor_sort));
        last = partition[i];
    }

    return result;
};



// -- stringifiers
//    ------------

topic_label = function (m, t, n) {
    var label;

    label = String(t + 1); // user-facing index is 1-based
    label += " ";
    label += m.topic_words(t, n).join(" ");
    return label;
};

topic_link = function (t) {
    return "#/topic/" + (t + 1);
};

cite_doc = function (m, d) {
    var doc, lead, result;

    doc = m.meta(d);
    // TODO factor out sort-name extraction (to use with doc_sort_key too)
    // fails on Jr., 2nd, etc.
    if(doc.authors.length > 0) {
        lead = doc.authors[0].split(" ");
        result = lead.pop() + ", ";
        result += lead.join(" ");
        if(doc.authors.length > 1) {
            if(doc.authors.length > 2) {
                result += ", ";
                result += doc.authors
                    .slice(1,doc.authors.length - 1)
                    .join(", ");
            }
            result += ", and " + doc.authors[doc.authors.length - 1];
        }
    } else {
            result = "[Anon]";
    }

    result += ". ";
    result += '"' + doc.title + '."';
    result += " <em>" + doc.journaltitle + "</em> ";
    result += doc.volume + ", no. " + doc.issue;

    result += " (" + VIS.cite_date_format(doc.date) + "): ";
    result += doc.pagerange + ".";

    result = result.replace(/_/g, ",");
    result = result.replace(/\t/g, "");

    return result;
};

doc_uri = function (m, d) {
    return "http://dx.doi.org"
        + VIS.uri_proxy
        + "/"
        + m.meta(d).doi;
};


// Principal view-generating functions
// -----------------------------------

topic_view = function (m, t) {
    var view = d3.select("div#topic_view"),
        trs_w, trs_d, img;

    if (!m.meta() || !m.dt() || !m.tw() || !m.doc_len()) {
        // not ready yet; show loading message
        view_loading(true);
        return true;
    }

    // TODO don't need anything but tw to show topic words h2 and div; so can 
    // have div-specific loading messages instead

    // get top words and weights
    // -------------------------

    view.select("h2")
        .text(topic_label(m, t, VIS.overview_words));

    view.select("p#topic_remark")
        .text("α = " + VIS.float_format(m.alpha(t)));


    trs_w = view.select("table#topic_words tbody")
        .selectAll("tr")
        .data(m.topic_words(t, m.n_top_words()));

    trs_w.enter().append("tr");
    trs_w.exit().remove();

    // clear rows
    trs_w.selectAll("td").remove();

    trs_w
        .append("td").append("a")
        .attr("href", function (w) {
            return "#/word/" + w;
        })
        .text(function (w) { return w; });

    trs_w
        .append("td")
        .text(function (w) {
            return m.tw(t,w);
        });


    // get top articles
    // ----------------

    trs_d = view.select("table#topic_docs tbody")
        .selectAll("tr")
        .data(m.topic_docs(t, VIS.topic_view_docs));

    trs_d.enter().append("tr");
    trs_d.exit().remove();

    // clear rows
    trs_d.selectAll("td").remove();

    trs_d
        .append("td").append("a")
        .attr("href", function (d) {
            return "#/doc/" + d.doc;
        })
        .html(function (d) {
            return cite_doc(m, d.doc);
        });

    trs_d
        .append("td")
        .text(function (d) {
            return VIS.percent_format(d.frac);
        });

    trs_d
        .append("td")
        .text(function (d) {
            return d.weight;
        });


    // Plot topic over time
    // --------------------

    if (VIS.prefab_plots) {
        // Set image link
        img = d3.select("#topic_plot img");
        if(img.empty()) {
            img = d3.select("#topic_plot").append("img"); 
        }

        img.attr("src", "topic_plot/" + d3.format("03d")(t + 1) + ".png")
            .attr("title", "yearly proportion of topic " + (t + 1));
    }
    else {
        plot_topic_yearly(m, t);
    }
    view_loading(false);

    return true;
    // TODO visualize word and doc weights as lengths
    // (later: nearby topics by J-S div or cor on log probs)
};

plot_topic_yearly = function(m, t) {
    var year_seq, series = [],
        w, scale_x, scale_y,
        rects, axis_x, axis_y, 
        svg = plot_svg();

    series = m.topic_yearly(t).keys().sort().map(function (y) {
        return [new Date(+y, 0, 1), m.topic_yearly(t).get(y)];
    });

    scale_x = d3.time.scale()
        .domain([series[0][0],
                d3.time.day.offset(series[series.length - 1][0],
                    VIS.plot.bar_width)])
        .range([0, VIS.plot.w]);
        //.nice();

    w = scale_x(d3.time.day.offset(series[0][0],VIS.plot.bar_width)) -
        scale_x(series[0][0]);


    scale_y = d3.scale.linear()
        .domain([0, d3.max(series, function (d) {
            return d[1];
        })])
        .range([VIS.plot.h, 0])
        .nice();

    // axes
    // ----

    // clear
    svg.selectAll("g.axis").remove();

    // x axis
    svg.append("g")
        .classed("axis",true)
        .classed("x",true)
        .attr("transform","translate(0," + VIS.plot.h + ")")
        .call(d3.svg.axis()
            .scale(scale_x)
            .orient("bottom")
            .ticks(d3.time.years,VIS.plot.ticks));

    // y axis
    svg.append("g")
        .classed("axis",true)
        .classed("y",true)
        .call(d3.svg.axis()
            .scale(scale_y)
            .orient("left")
            .tickSize(-VIS.plot.w)
            .outerTickSize(0)
            .tickFormat(VIS.percent_format)
            .ticks(VIS.plot.ticks));

    svg.selectAll("g.axis.y g").filter(function(d) { return d; })
        .classed("minor", true);

    // bars
    // ----

    // clear
    svg.selectAll("rect.topic_proportion").remove();

    rects = svg.selectAll("rect")
        .data(series);

    rects.enter().append("rect");

    rects.classed("topic_proportion",true)
        .attr("x", function (d) {
            return scale_x(d[0]);
        })
        .attr("y", function (d) {
            return scale_y(d[1]);
        })
        .attr("width",w)
        .attr("height", function (d) {
            return VIS.plot.h - scale_y(d[1]);
        });
};


word_view = function (m, word) {
    var view = d3.select("div#word_view"),
        trs, topics;

    if (word === undefined) {
        return false;
    }

    if (!m.tw()) {
        view_loading(true);
        return true;
    }


    view.select("h2")
        .text(word);

    topics = m.word_topics(word);

    // TODO alert if topics.length == 0

    trs = view.select("table#word_topics tbody")
        .selectAll("tr")
        .data(topics);

    trs.enter().append("tr");
    trs.exit().remove();

    // clear rows
    trs.selectAll("td").remove();

    trs.append("td")
        .text(function (d) {
            return d.rank + 1; // user-facing rank is 1-based
        });

    trs.append("td").append("a")
        .text(function (d) {
            return topic_label(m, d.topic, VIS.overview_words);
        })
        .attr("href", function (d) {
            return topic_link(d.topic);
        });

    view_loading(false);
    return true;

    // (later: time graph)
};

doc_view = function (m, doc) {
    var view = d3.select("div#doc_view"),
        trs;

    if (!m.meta() || !m.dt() || !m.tw() || !m.doc_len()) {
        view_loading(true);
        return true;
    }
    
    // TODO asynchronous loading of different pieces of view

    view.select("#doc_view h2")
        .html(cite_doc(m, doc));

    view.select("p#doc_remark")
        .html(m.doc_len(doc) + " tokens. "
                + '<a class ="external" href="'
                + doc_uri(m, doc)
                + '">View '
                + m.meta(doc).doi
                + " on JSTOR</a>");

    trs = view.select("table#doc_topics tbody")
        .selectAll("tr")
        .data(m.doc_topics(doc, VIS.doc_view_topics));

    trs.enter().append("tr");
    trs.exit().remove();

    // clear rows
    trs.selectAll("td").remove();

    trs.append("td").append("a")
        .attr("href", function (t) {
            return topic_link(t.topic);
        })
        .text(function (t) {
            return topic_label(m, t.topic, VIS.overview_words);
        });
    trs.append("td")
        .text(function (t) {
            return t.weight;
        });
    trs.append("td")
        .text(function (t) {
            return VIS.percent_format(t.weight / m.doc_len(doc));
        });

    view_loading(false);
    return true;
    // TODO visualize topic proportions as rectangles at the very least

    // (later: nearby documents)
};

bib_view = function (m) {
    var view = d3.select("div#bib_view"),
        ordering, nav_as, sections, headings, as;

    if (VIS.ready.bib) {
        return true;
    }

    if (!m.meta()) {
        view_loading(true);
        return true;
    }

    ordering = bib_sort(m, VIS.bib_sort.major, VIS.bib_sort.minor);

    VIS.ordering = ordering;

    // TODO fix page-jumping #links
    // TODO use bootstrap accordions?
    /*
    nav_as = view.select("nav")
        .selectAll("a")
        .data(ordering.headings);

    nav_as.enter().append("a");
    nav_as.exit().remove();

    nav_as
        .attr("href", function (h) { return "#" + h; })
        .text(function (h) { return h; });
    nav_as
        .attr("href", "#/bib")
        .text(function (h) { return h; });
    */
    sections = view.select("div#bib_main")
        .selectAll("section")
        .data(ordering.headings);

    sections.enter()
        .append("section")
        .append("h2");

    sections.exit().remove();

    headings = sections.selectAll("h2");

    headings
        .attr("id", function (h) {
            return h;
        })
        .text(function (h) { return h; });

    as = sections
        .selectAll("a")
        .data(function (h, i) {
            return ordering.docs[i];
        });

    as.enter().append("a");
    as.exit().remove();

    // TODO list topics in bib entry?

    as
        .attr("href", function (d) {
            return "#/doc/" + d;
        })
        .html(function (d) {
            return cite_doc(m, d);
        });

    VIS.ready.bib = true;

    view_loading(false);
    return true;

};

about_view = function (m) {
    if(!VIS.ready.about) {
        d3.select("div#meta_info")
            .html(m.info().meta_info);
        VIS.ready.about = true;
    }
    d3.select("#about_view").classed("hidden", false);
    return true;
};


model_view = function (m) {
    var view = d3.select("#model_view"),
        trs;

    if (VIS.ready.model) {
        view.classed("hidden", false);
        return true;
    }

    if (!m.tw()) {
        view_loading(true);
        return true;
    }

    trs = d3.select("table#model_topics tbody")
        .selectAll("tr")
        .data(d3.range(m.n()));

    // clear rows
    trs.selectAll("td").remove();

    trs.enter().append("tr");
    trs.exit().remove();

    trs.append("td").append("a")
        .text(function (t) { return t + 1; }) // sigh
        .attr("href", topic_link);

    trs.append("td").append("a")
        .text(function (t) {
            return m.topic_words(t, VIS.overview_words).join(" ");
        })
        .attr("href", topic_link);

    trs.append("td")
        .text(function (t) {
            return VIS.float_format(m.alpha(t));
        });

    VIS.ready.model = true;

    view_loading(false);
    return true;

    // TODO visualize alphas
    // (later: word clouds)
    // (later: grid of time graphs)
    // (later: multi-dimensional scaling projection showing topic clusters)
};

view_loading = function (flag) {
    d3.select("div#loading").classed("hidden", !flag);
};

view_refresh = function (m, v) {
    var view_parsed, param, success;

    view_parsed = v.split("/");
    param = view_parsed[2];

    if (VIS.cur_view !== undefined) {
        VIS.cur_view.classed("hidden", true);
    }

    switch (view_parsed[1]) {
        case undefined:
            view_parsed[1] = "model";
            success = model_view(m);
            break;
        case "model":
            success = model_view(m);
            break;
        case "about":
            success = about_view(m);
            break;
        case "bib":
            success = bib_view(m);
            break;
        case "topic":
            // TODO interactive specification of param if missing
            // to support raw #/topic links
            param = +param - 1;
            success = topic_view(m, param);
            break;
        case "word":
            // TODO support raw #/word links w/ no param
            success = word_view(m, param);
            break;
        case "doc":
            // TODO support raw #/doc links w/ no param
            // (incl. toggle active state on navbar)
            param = +param;
            success = doc_view(m, param);
            break;
        default:
            success = false;
            break;
    }

    if (success) {
        VIS.cur_view = d3.select("div#" + view_parsed[1] + "_view");
    } else {
        if (VIS.cur_view === undefined) {
            // fall back on model_view
            VIS.cur_view = d3.select("div#model_view");
            model_view(m);
        } 
    }

    VIS.cur_view.classed("hidden",false);

    // ensure highlighting of nav link
    d3.selectAll("li.active").classed("active",false);
    d3.select("li#nav_" + view_parsed[1]).classed("active",true);

};


// initialization
// --------------

// global visualization setup
setup_vis = function (m) {
    var key;

    // ensure plot div has size
    d3.select("div#topic_plot")
        .attr("width", VIS.plot.w + VIS.plot.m.left + VIS.plot.m.right)
        .attr("height", VIS.plot.h + VIS.plot.m.top + VIS.plot.m.bottom);

    // load any preferences stashed in model info

    if (m.info().VIS) {
        for (key in m.info().VIS) {
            if (m.info().VIS.hasOwnProperty(key)
                    && typeof(m.info().VIS[key] !== 'function')) {
                VIS[key] = m.info().VIS[key];
            }
        }
    }

    // model title
    d3.select("#model_title")
        .text(m.info().title);

    // hashchange handler

    window.onhashchange = function () {
        view_refresh(m, window.location.hash, false);
    };


    // TODO settings controls
    
};

plot_svg = function () {
    if(VIS.svg) {
        return VIS.svg;
    }

    // mbostock margin convention
    // http://bl.ocks.org/mbostock/3019563
    VIS.svg = d3.select("div#topic_plot")
        .append("svg")
            .attr("width", VIS.plot.w + VIS.plot.m.left + VIS.plot.m.right)
            .attr("height", VIS.plot.h + VIS.plot.m.top + VIS.plot.m.bottom)
        // g element passes on xform to all contained elements
        .append("g")
            .attr("transform",
                  "translate(" + VIS.plot.m.left + "," + VIS.plot.m.top + ")");

    return VIS.svg;
};

var load_data = function (target, callback) {
    var target_stem = target.replace(/\..*$/, ""),
        target_id;

    if (VIS.loaded[target_stem]) {
        return callback(undefined, undefined);
    }
    
    // preprocessed data available in DOM?
    target_id = "m__DATA__" + target_stem;
    if (document.getElementById(target_id)) {
        VIS.loaded[target] = true;
        return callback(undefined,
                document.getElementById(target_id).innerHTML);
    }
    
    // otherwise, we have to fetch it, and possibly unzip it
    // TODO zipping...
    return d3.text("data/" + target, function (error, s) {
        VIS.loaded[target] = true;
        return callback(error, s);
    });
};


// main
// ----

main = function () {
    load_data("info.json",function (error, info_s) {
        // callback, invoked when ready 
        var m = model({ info: JSON.parse(info_s) });
        setup_vis(m);

        // FIXME testing only
        VIS.m = m;

        // now launch remaining data loading; ask for a refresh when done
        load_data("meta.csv", function (error, meta_s) {
            m.set_meta(meta_s);
            view_refresh(m, window.location.hash);
        });
        load_data("dt.json", function (error, dt_s) {
            m.set_dt(dt_s);
            view_refresh(m, window.location.hash);
        });
        load_data("tw.json", function (error, tw_s) {
            m.set_tw(tw_s);
            view_refresh(m, window.location.hash);
        });
        load_data("doc_len.json", function (error, doc_len_s) {
            m.set_doc_len(doc_len_s);
            VIS.m = m;
            view_refresh(m, window.location.hash);
        });

        view_refresh(m, window.location.hash);
    });
};

// execution

main();

