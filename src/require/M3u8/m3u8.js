function M3U8() {
    var _this = this; // access root scope

    this.ie = navigator.appVersion.toString().indexOf(".NET") > 0;
    this.ios = navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform);


    this.start = function(m3u8, options) {

        if (!options)
            options = {};

        var callbacks = {
            progress: null,
            finished: null,
            error: null,
            aborted: null
        }

        var recur; // the recursive download instance to later be initialized. Scoped here so callbakcs can access and manage it.

        function handleCb(key, payload) {
            if (key && callbacks[key])
                callbacks[key](payload);
        }

        if (_this.ios)
            return handleCb("error", "Downloading on IOS is not supported.");

        var startObj = {
            on: function(str, cb) {
                switch (str) {
                    case "progress": {
                        callbacks.progress = cb;
                        break;
                    }
                    case "finished": {
                        callbacks.finished = cb;
                        break;
                    }
                    case "error": {
                        callbacks.error = cb;
                        break;
                    }
                    case "aborted": {
                        callbacks.aborted = cb;
                        break;
                    }
                }

                return startObj;
            },
            abort: function() {
                ;
                recur && (recur.aborted = function() {
                    handleCb("aborted");
                });
            }
        }

        var download = new Promise(function(resolve, reject) {
            var url = new URL(m3u8);

            var req = fetch(m3u8)
                .then(function(d) {
                    return d.text();
                })
                .then(function(d) {

                    var filtered = filter(d.split(/(\r\n|\r|\n)/gi), function(item) {
                        return item.indexOf(".ts") > -1; // select only ts files
                    });

                    var mapped = map(filtered, function(v, i) {
                        if (v.indexOf("http") === 0 || v.indexOf("ftp") === 0) { // absolute url
                            return v;
                        }
                        return url.protocol + "//" + url.host + url.pathname + "/./../" + v; // map ts files into url
                    });

                    if (!mapped.length) {
                        reject("Invalid m3u8 playlist");
                        return handleCb("error", "Invalid m3u8 playlist");
                    }

                    recur = new RecurseDownload(mapped, function(data) {

                        var blob = new Blob(data, {
                            type: "octet/stream"
                        });

                        handleCb("progress", {
                            status: "Processing..."
                        });

                        if (!options.returnBlob) {
                            if (_this.ios) {
                                // handle ios?
                            } else if (_this.ie) {
                                handleCb("progress", {
                                    status: "Sending video to Internet Explorer... this may take a while depending on your device's performance."
                                });
                                window.navigator.msSaveBlob(blob, (options && options.filename) || "video.mp4");
                            } else {
                                handleCb("progress", {
                                    status: "Sending video to browser..."
                                });
                                var a = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
                                a.href = URL.createObjectURL(blob);
                                a.download = (options && options.filename) || "video.mp4";
                                a.style.display = "none";
                                document.body.appendChild(a); // Firefox fix
                                a.click();
                                handleCb("finished", {
                                    status: "Successfully downloaded video",
                                    data: blob
                                });
                                resolve(blob);
                            }
                        } else {
                            handleCb("finished", {
                                status: "Successfully downloaded video",
                                data: blob
                            });
                            resolve(blob)
                        }


                    }, 0, []);

                    recur.onprogress = function(obj) {
                        handleCb("progress", obj);
                    }

                })
                .catch(function(err) {
                    handleCb("error", "Something went wrong when downloading m3u8 playlist: " + err);
                });
        });

        return startObj;

    }

    function RecurseDownload(arr, cb, i, data) { // recursively download asynchronously 2 at the time
        var _this = this;

        this.aborted = false;
        this.threadNum = 10;
        this.step = 0;

        recurseDownload(arr, cb, i, data);

        function recurseDownload(arr, cb, i, data) {
            let taskList = [];
            for (let j = 0; j < _this.threadNum; j++) {
                if (arr[i+j]) {
                    taskList.push(fetch(arr[i+j]).catch(err => {
                        fetch(arr[i+j]).catch(err => {
                            fetch(arr[i+j]);
                        })
                    }));
                } else {
                    taskList.push(Promise.resolve());
                    break;
                }
            }
            _this.step = taskList.length;
            var req = Promise.all(taskList) // HTTP protocol dictates only TWO requests can be simultaneously performed
                .then(function(d) {
                    return map(filter(d, function(v) {
                        return v && v.blob;
                    }), function(v) {
                        return v.blob();
                    });
                })
                .then(function(d) {
                    return Promise.all(d);
                })
                .then(function(d) {

                    var blobs = map(d, function(v, j) {
                        return new Promise(function(resolve, reject) {
                            var reader = new FileReader();

                            var read = reader.readAsArrayBuffer(new Blob([v], {
                                type: "octet/stream"
                            })); // IE can't read Blob.arrayBuffer :(

                            reader.addEventListener("loadend", function(event) { 

                                resolve(reader.result);;
                                (_this.onprogress && _this.onprogress({
                                    segment: i + j + 1,
                                    total: arr.length,
                                    percentage: ((i + j + 1) / arr.length * 100).toFixed(3),
                                    downloaded: formatNumber(+reduce(map(data, function(v) {
                                        return v.byteLength;
                                    }), function(t, c) {
                                        return t + c;
                                    }, 0)),
                                    status: "Downloading..."
                                }));
                            });
                        });
                    });

                    Promise.all(blobs).then(function(d) {
                        for (var n = 0; n < d.length; n++) { // polymorphism
                            data.push(d[n]);
                        }
                        let step = _this.step;
                        var increment = arr[i + 2] ? 2 : 1; 

                        if (_this.aborted) {
                            data = null; 
                            _this.aborted();
                            return; // exit promise
                        } else if (arr[i + step]) {
                            if (_this.ie) {
                                setTimeout(function() {
                                    recurseDownload(arr, cb, i + step, data);
                                }, 500);
                            } else {
                                recurseDownload(arr, cb, i + step, data);
                            }
                        } else {
                            cb(data);
                        }
                    });

                })
                .catch(function(err) {
                    ;
                    _this.onerror && _this.onerror("Something went wrong when downloading ts file, nr. " + i + ": " + err);
                });
        }

    }

    function filter(arr, condition) {
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            if (condition(arr[i], i)) {
                result.push(arr[i]);
            }
        }
        return result;
    }

    function map(arr, condition) {
        var result = arr.slice(0);
        for (var i = 0; i < arr.length; i++) {
            result[i] = condition(arr[i], i);
        }
        return result;
    }

    function reduce(arr, condition, start) {
        var result = start;
        arr.forEach(function(v, i) {
            var res = +condition(result, v, i);
            result = res;
        });
        return result;
    }



    function formatNumber(n) {

        var ranges = [{
                divider: 1e18,
                suffix: "EB"
            },
            {
                divider: 1e15,
                suffix: "PB"
            },
            {
                divider: 1e12,
                suffix: "TB"
            },
            {
                divider: 1e9,
                suffix: "GB"
            },
            {
                divider: 1e6,
                suffix: "MB"
            },
            {
                divider: 1e3,
                suffix: "kB"
            }
        ]
        for (var i = 0; i < ranges.length; i++) {
            if (n >= ranges[i].divider) {
                var res = (n / ranges[i].divider).toString()

                return res.toString().split(".")[0] + ranges[i].suffix;
            }
        }
        return n.toString();
    }
}
