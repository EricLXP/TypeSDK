/**
 * Created by TypeSDK 2016/10/10.
 */
var crypto = require('crypto');
var request = require('request');
var merge = require('merge');
var logicCommon = require('./logicCommon.js');

function convertParamLogin(query, ret) {
    var org =
    {
        "id": "0"
        , "token": ""
        , "data": ""
        , "sign": ""
    };

    var cloned = merge(true, org);
    merge(cloned, query);

    for (var i in cloned) {
        //判断参数中是否该有的字段齐全
        if (org[i] == cloned[i] && i != "data") {
            return false;
        }

        //判断参数中是否有为空的字段
        if (0 == (cloned[i] + "").replace(/(^s*)|(s*$)/g, "").length && i != "data") {
            return false;
        }
    }

    ret.sid = cloned.token;
    //ret.sign = cloned.sign;

    return true;
}

function GetNowStr() {
    var util = require('util');
    var now = new Date();

    pad = function (tbl) {
        return function (num, n) {
            return (0 >= (n = n - num.toString().length)) ? num : (tbl[n] || (tbl[n] = Array(n + 1).join(0))) + num;
        }
    }([]);
    var result = '' + now.getFullYear() +
        pad(now.getMonth() + 1, 2) +
        pad(now.getDate(), 2) +
        pad(now.getHours(), 2) +
        pad(now.getMinutes(), 2) +
        pad(now.getSeconds(), 2) +
        pad(now.getMilliseconds(), 3);


    return result;
}

function callChannelLogin(attrs, params, query, ret, retf) {
    var cloned = merge(true, params.out_params);
    merge(cloned, query);
    cloned.appkey = attrs.app_key;
    cloned.sid = query.sid;
    var signStr = new Buffer(attrs.app_key + query.sid + attrs.secret_key);
    var signBase64 = signStr.toString('base64');
    cloned.sign = signBase64;
    cloned.time = GetNowStr();
    var options = {
        url: params.out_url,
        method: params.method,
        formData: cloned
    };

    console.log(options);

    //打点：登录验证
    logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.RelaySDKVerify);
    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var retOut = JSON.parse(body.replace(/\'/g, "\""));
            if (retOut.st == '成功(sid有效)') {
                //打点：验证成功
                logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.ChVerifySuc);

                var idobjstr = new Buffer(retOut.msg, 'base64').toString("utf8");
                var idobj = JSON.parse(idobjstr.replace(/\'/g, "\""));

                ret.code = 0;
                ret.msg = "NORMAL";
                ret.id = idobj.uid;
                ret.nick = "";
                ret.token = "";
                ret.value = retOut;
            }
            else {
                //打点：验证失败
                logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.ChVerifyErr);
                ret.code = 1;
                ret.msg = "LOGIN User ERROR";
                ret.id = "";
                ret.nick = "";
                ret.token = "";
                ret.value = retOut;
            }
        }
        else {
            //打点：验证失败
            logicCommon.sdkMonitorDot(logicCommon.dotType.LoginDot.ChVerifyErr);
            ret.code = 2;
            ret.msg = "OUT URL ERROR";
            ret.value = "";
        }
        retf(ret);
    });
}
function compareOrder(attrs, gattrs, params, query, ret, game, channel, retf) {
    var retStr = checkSignPay(attrs, query);
    if (!retStr[0]) {
        retf('FAILURE');
        return;
    }

    var retValue = {};
    retValue.code = retStr[1].code == '1' ? '0' : '1';
    retValue.id = retStr[1].uid;
    retValue.order = retStr[1].orderId;
    retValue.cporder = retStr[1].cpInfo;
    retValue.info = "";
    if (retValue.code != '0') {
        retf('FAILURE');
        return;
    }
    logicCommon.getNotifyUrl(retValue.cporder, params, function (hasData) {
        if (!hasData) {
            retf('FAILURE');
            return;
        } else {
            retValue.sign = logicCommon.createSignPay(retValue, gattrs.gkey);
            logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 1, 0,query);

            var options = {
                url: params.verifyurl,
                method: "POST",
                body: retValue,
                json: true
            };
            request(options, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    var retOut = body;
                    if (typeof retOut.code == 'undefined') {
                        retf('FAILURE');
                        return;
                    }
                    if (retOut.code == '0') {
                        if(retOut.Itemid){
                             logicCommon.mapItemLists(attrs,retOut);
                        }
                        if (retStr[1].uid == retOut.id
                            && retStr[1].payAmount >= retOut.amount * 0.9
                            && retStr[1].payAmount <= retOut.amount) {
                            if (retOut.status == '2') {
                                retf('FAILURE');
                                return;
                            } else if (retOut.status == '4' || retOut.status == '3') {
                                logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 4,retStr[1].payAmount);
                                retf('success');
                                return;
                            } else {
                                logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 2,0);
                                var data = {};
                                data.code = '0000';
                                data.msg = 'NORMAL';
                                retf(data);
                                return;
                            }
                        } else {
                            logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 3,0);
                            retf('FAILURE');
                            return;
                        }
                    } else {
                        retf('FAILURE');
                        return;
                    }
                } else {
                    retf('FAILURE');
                    return;
                }
            });
        }
    });
}

function callGamePay(attrs, gattrs, params, query, ret, retf, game, channel, channelId) {
    var retStr = checkSignPay(attrs, query);
    if (!retStr[0]) {
        //打点：其他支付失败
        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
        retf('FAILURE');
        return;
    }

    var retValue = {};
    retValue.code = retStr[1].code == '1' ? '0' : '1';
    retValue.id = retStr[1].uid;
    retValue.order = retStr[1].orderId;
    retValue.cporder = retStr[1].cpInfo;
    retValue.info = "";

    if (retValue.code != '0') {
        //打点：其他支付失败
        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
        retf('FAILURE');
        return;
    }

    logicCommon.getNotifyUrl(retValue.cporder, params, function (hasData) {
        if (!hasData) {
            //打点：其他支付失败
            logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
            retf('FAILURE');
        } else {
            retValue.sign = logicCommon.createSignPay(retValue, gattrs.gkey);

            retValue.gamename = game;
            retValue.sdkname = channel;
            retValue.channel_id = channelId;
            retValue.amount = '' + retStr[1].payAmount + '';


            var options = {
                url: params.out_url,
                method: params.method,
                body: retValue,
                json: true
            };
            console.log(options);

            //打点：支付回调通知
            logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.PayNotice);
            request(options, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    var retOut = body;

                    //日志记录CP端返回
                    console.log(retOut);
                    if (typeof retOut.code == 'undefined') {
                        //打点：其他支付失败
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                        retf('FAILURE');
                    }

                    if (retOut.code == 0) {
                        //打点：服务器正确处理支付成功回调
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.PaySuc);
                        logicCommon.UpdateOrderStatus(game, channel, retValue.cporder, retValue.order, 4,retStr[1].payAmount);
                        retf('success');
                    }
                    else{
                        //打点：其他支付失败
                        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                        retf('FAILURE');
                    }
                } else {
                    //打点：其他支付失败
                    logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
                    retf('FAILURE');
                }
            });
        }
    });
}

function checkSignPay(attrs, query) {
    var data = query.data;
    console.log('Original cleartext: ' + data);
    var algorithm = 'des-ede3';
    var key = attrs.secret_key;
    var clearEncoding = 'utf8';
    var iv = "";

    var cipherEncoding = 'base64';

    var cipherChunks = [];
    cipherChunks.push(data);
    var decipher = crypto.createDecipheriv(algorithm, key, iv);
    var plainChunks = [];
    for (var i = 0; i < cipherChunks.length; i++) {
        plainChunks.push(decipher.update(cipherChunks[i], cipherEncoding, clearEncoding));
    }
    plainChunks.push(decipher.final(clearEncoding));
    var StrData = JSON.parse(plainChunks.join(''));

    if (StrData.code != "1") {
        return false;
    }

    return [true, StrData];

}


function checkOrder() {
    return false;
}

/**
 * 核实外部订单号的唯一性
 * @param
 *      query   请求串Obj
 *      retf    返回校验结果 True 合法|False 不合法
 * */
function checkChOrder(game, channel,attrs, query, retf){
    var retStr = checkSignPay(attrs, query);
    var isIllegal = false;
    if (!retStr[0]) {
        //打点：其他支付失败
        logicCommon.sdkMonitorDot(logicCommon.dotType.PayDot.Error);
        retf(isIllegal);
        return;
    }

    logicCommon.selCHOrderInRedis(channel,retStr[1].orderId,function(res){
        if(!res || typeof res == "undefined"){
            logicCommon.saveCHOrderInRedis(game, channel, retStr[1].cpInfo, retStr[1].orderId,function(res){
                if(res && typeof res != "undefined"){
                    isIllegal = true;
                    retf(isIllegal);
                }else{
                    retf(isIllegal);
                }
            });
        }else{
            retf(isIllegal);
        }
    });
}

exports.convertParamLogin = convertParamLogin;
exports.callChannelLogin = callChannelLogin;
exports.checkSignPay = checkSignPay;
exports.callGamePay = callGamePay;
exports.checkOrder = checkOrder;

exports.compareOrder = compareOrder;
exports.checkChOrder = checkChOrder;