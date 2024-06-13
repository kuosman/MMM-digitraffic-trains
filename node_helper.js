var moment = require('moment');
const request = require('request');
var NodeHelper = require('node_helper');

module.exports = NodeHelper.create({
    config: {},
    stationsCache: null,
    updateTimer: null,
    /**
     * Start
     * @method @public start
     */
    start: function () {
        moment.locale(config.language || 'fi');
    },
    /**
     * Socket notification received
     * @param {String} notification notification
     * @param {Object} payload payload
     */
    socketNotificationReceived: function (notification, payload) {
        if (
            notification === 'MMM_DIGITRAFFIC_TRAINS_CONFIG' &&
            this.stationsCache !== null
        ) {
            this.config = payload.config;
            this.fetchDigitraffic(payload.identifier);
        } else if (
            notification === 'MMM_DIGITRAFFIC_TRAINS_CONFIG' &&
            this.stationsCache === null
        ) {
            this.fetchStations(payload.identifier);
        } else if (notification === 'MMM_DIGITRAFFIC_TRAINS_GET_STATIONS') {
            this.fetchStations(payload.identifier);
        }
    },
    /**
     * Fetches station
     * @method @public fetchStations
     * @param identifier string
     */
    fetchStations(identifier) {
        var self = this;
        request(
            {
                headers: {
                    'accept-encoding': 'gzip',
                },
                url: 'https://rata.digitraffic.fi/api/v1/metadata/stations',
                method: 'GET',
                gzip: true,
            },
            function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    var stations = JSON.parse(body);

                    stationsCache = {};
                    stations.forEach((station) => {
                        stationsCache[station.stationShortCode] =
                            station.stationName.replace(' asema', '');
                    });

                    self.stationsCache = stationsCache;

                    self.sendSocketNotification(
                        'MMM_DIGITRAFFIC_TRAINS_STATIONS_RESPONSE',
                        {
                            data: stationsCache,
                            identifier: identifier,
                        }
                    );
                } else {
                    self.sendSocketNotification(
                        'MMM_DIGITRAFFIC_TRAINS_STATIONS_RESPONSE_ERROR',
                        {
                            response: response,
                            identifier: identifier,
                        }
                    );
                }
            }
        );
    },
    /**
     * Fetches digitraffic data
     * @method @public fetchDigitraffic
     * @param {string} identifier identifier
     */
    fetchDigitraffic(identifier) {
        var self = this;

        var url =
            'https://rata.digitraffic.fi/api/v1/live-trains' +
            '?station=' +
            self.config.station +
            '&arrived_trains=0' +
            '&arriving_trains=0' +
            '&departed_trains=0' +
            '&departing_trains=' +
            self.config.trainCount;
        request(
            {
                headers: {
                    'accept-encoding': 'gzip',
                },
                url: url,
                method: 'GET',
                gzip: true,
            },
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    var trains = [];
                    var data = JSON.parse(body);

                    // loop trains
                    data.forEach((train) => {
                        var lineID = train.commuterLineID;
                        var scheduledTime;
                        var estimateTime;
                        var track;
                        var destination;

                        // get the estimated time
                        train.timeTableRows.some((timeTable) => {
                            if (
                                timeTable.stationShortCode ===
                                    self.config.station &&
                                timeTable.type === 'DEPARTURE'
                            ) {
                                scheduledTime = new Date(
                                    timeTable.scheduledTime
                                );
                                estimateTime = timeTable.liveEstimateTime
                                    ? new Date(timeTable.liveEstimateTime)
                                    : scheduledTime;
                                track = timeTable.commercialTrack;
                                return true;
                            }
                        });

                        // get destination (last entry)
                        var ttDestination =
                            train.timeTableRows[train.timeTableRows.length - 1];
                        destination = ttDestination.stationShortCode;
                        train.scheduledTime =
                            moment(scheduledTime).format('HH:mm');
                        train.estimateTime =
                            moment(estimateTime).format('HH:mm');
                        train.lineID = lineID;
                        train.track = track;
                        train.destination = destination;
                        trains.push(train);
                    });

                    trains.sort(function (a, b) {
                        a =
                            a.scheduledTime != a.estimateTime
                                ? a.estimateTime
                                : a.scheduledTime;
                        b =
                            b.scheduledTime != b.estimateTime
                                ? b.estimateTime
                                : b.scheduledTime;
                        return a > b ? 1 : a < b ? -1 : 0;
                    });
                    self.sendSocketNotification(
                        'MMM_DIGITRAFFIC_TRAINS_TIME_TABLE_RESPONSE',
                        {
                            data: trains,
                            identifier: identifier,
                        }
                    );
                } else {
                    self.sendSocketNotification(
                        'MMM_DIGITRAFFIC_TRAINS_TIME_TABLE_RESPONSE_ERROR',
                        {
                            response: response,
                            identifier: identifier,
                        }
                    );
                }
            }
        );
    },
});
