module.exports = NotificationService;

var logger = require('../log/index.js')('NotificationService');
var util = require('../util/util.js');
var apn = require('apn');
var apnTokenTTL = 3600 * 24 * 7;


function NotificationService(apnConfigs, redis, ttlService) {
    if (!(this instanceof NotificationService)) return new NotificationService(apnConfigs, redis, ttlService);
    this.redis = redis;
    this.ttlService = ttlService;
    var self = this;
    apnConfigs.forEach(function (apnConfig) {
        if (!self.defaultBundleId) {
            self.defaultBundleId = apnConfig.bundleId;
        }
    });

    logger.info("defaultBundleId %s", this.defaultBundleId);
}

NotificationService.prototype.setApnToken = function (pushId, apnToken, bundleId) {
    if (pushId && apnToken) {
        if (!bundleId) {
            bundleId = this.defaultBundleId;
        }
        try {
            new Buffer(apnToken, 'hex');
        } catch (err) {
            logger.info("invalid apnToken format %s", apnToken);
            return;
        }
        var apnData = JSON.stringify({bundleId: bundleId, apnToken: apnToken});
        var self = this;
        this.redis.get("apnTokenToPushId#" + apnToken, function (err, oldPushId) {
            logger.info("oldPushId %s", oldPushId);
            if (oldPushId && oldPushId != pushId) {
                self.redis.del("pushIdToApnData#" + oldPushId);
                logger.info("remove old pushId to apnToken %s %s", oldPushId, apnData);
            }
            self.redis.set("apnTokenToPushId#" + apnToken, pushId);
            self.redis.set("pushIdToApnData#" + pushId, apnData);
            self.redis.hset("apnTokens#" + bundleId, apnToken, Date.now());
            self.redis.expire("pushIdToApnData#" + pushId, apnTokenTTL);
            self.redis.expire("apnTokenToPushId#" + apnToken, apnTokenTTL);
        });
    }
};

NotificationService.prototype.sendByPushIds = function (pushIds, timeToLive, notification, io) {
    var self = this;
    pushIds.forEach(function (pushId) {
        self.redis.get("pushIdToApnData#" + pushId, function (err, reply) {
            logger.info("pushIdToApnData %s %s", pushId, JSON.stringify(reply));
            if (reply) {
                var apnData = JSON.parse(reply);
                self.apnService.sendOne(apnData, notification, timeToLive);
            } else {
                logger.info("send notification to android %s", pushId);
                self.ttlService.addPacketAndEmit(pushId, 'noti', timeToLive, notification, io, true);
            }
        });
    });

};

NotificationService.prototype.sendAll = function (notification, timeToLive, io) {
    this.ttlService.addPacketAndEmit("noti", 'noti', timeToLive, notification, io, false);
    this.apnService.sendAll(notification, timeToLive);
};
