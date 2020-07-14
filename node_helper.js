var moment = require("moment");
const request = require("request");
var NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
  config: {},
  stationsCache: null,
  updateTimer: null,
  start: function () {
    moment.locale(config.language || "fi");
  },
  socketNotificationReceived: function (notification, payload) {
    if (notification === "CONFIG" && this.stationsCache !== null) {
      this.config = payload;
      this.fetchDigitraffic();
    } else if (notification === "CONFIG" && this.stationsCache === null) {
      this.fetchStations();
    } else if (notification === "GET_STATIONS") {
      this.fetchStations();
    }
  },
  fetchStations() {
    var self = this;
    request({
      headers: {
        "accept-encoding": "gzip"
      },
      url: "https://rata.digitraffic.fi/api/v1/metadata/stations",
      method: "GET",
      gzip: true
    }, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        var stations = JSON.parse(body);

        stationsCache = {};
        for (var s in stations) {
          var station = stations[s];
          stationsCache[station.stationShortCode] = station.stationName.replace(" asema", "");
        }

        self.stationsCache = stationsCache;

        self.sendSocketNotification("STATIONS_RESPONSE", {
          data: stationsCache
        });
      } else {
        self.sendSocketNotification("STATIONS_RESPONSE_ERROR", {
          response: response
        });
      }
    }
    );
  },
  fetchDigitraffic() {
    var self = this;

    var url = "https://rata.digitraffic.fi/api/v1/live-trains" +
      "?station=" + self.config.station +
      "&arrived_trains=0" +
      "&arriving_trains=0" +
      "&departed_trains=0" +
      "&departing_trains=" + self.config.trainCount;
    request({
      headers: {
        "accept-encoding": "gzip"
      },
      url: url,
      method: "GET",
      gzip: true
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var trains = [];
        var data = JSON.parse(body);
        for (var t = 0; t < data.length; t++) {
          var train = data[t];

          var lineID = train.commuterLineID;
          var cancelled = train.cancelled;
          var scheduledTime;
          var estimateTime;
          var track;
          var destination;

          //get the estimated time
          for (var i = 0; i < train.timeTableRows.length; i++) {
            var tt = train.timeTableRows[i];

            if (tt.stationShortCode === self.config.station && tt.type === 'DEPARTURE') {
              scheduledTime = new Date(tt.scheduledTime);
              estimateTime = (tt.liveEstimateTime) ? new Date(tt.liveEstimateTime) : scheduledTime;
              track = tt.commercialTrack;
              break;
            }
          }

          //get destination (last entry)
          var ttDestination = train.timeTableRows[train.timeTableRows.length - 1];
          destination = ttDestination.stationShortCode;
          train.scheduledTime = moment(scheduledTime).format("HH:mm");
          train.estimateTime = moment(estimateTime).format("HH:mm");
          train.lineID = lineID;
          train.track = track;
          train.destination = destination;
          trains.push(train);
        }

        trains.sort(function (a, b) {
          // if(scheduledTime != estimateTime) {
          a = (a.scheduledTime != a.estimateTime) ? a.estimateTime : a.scheduledTime;
          b = (b.scheduledTime != b.estimateTime) ? b.estimateTime : b.scheduledTime;
          return a > b ? 1 : a < b ? -1 : 0;
        });
        self.sendSocketNotification("TIME_TABLE_RESPONSE", {
          data: trains
        });
      } else {
        self.sendSocketNotification("TIME_TABLE_RESPONSE_ERROR", {
          response: response
        });
      }
    });
  }
});