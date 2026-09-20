/**
 * 校园招聘-官网 20190215
 */
(function($, win) {
	'use strict';
	win.namespaceRegister = function(objStr) {
		if (!objStr) {
			return;
		}
		var objs = objStr.split(".");
		var obj = window;
		var objLength = objs.length;
		for (var i = 0; i < objLength; i++) {
			obj = obj[objs[i]] = obj[objs[i]] || {}
		}
		return obj;
	};
	// 定义命名空间
	namespaceRegister("HW.Portal.Reccamp.Resume");
	namespaceRegister("HW.Portal.Reccamp.Job");
	var cm = namespaceRegister("HW.Portal.Reccamp.Common");
	// 公共配置
	cm.config = {
		baseUrl : "/reccampportal/",
		hostname : ".huawei.com",
		loginUrl : "/reccampportal/loginIndex?redirect=",
		registerUrl : "https://uniportal.huawei.com/accounts/register.do?method=toRegister&nls=",
		registerbetaUrl : "https://uniportal-beta.huawei.com/accounts/register.do?method=toRegister&nls="
	};
	var uniportalHost = window.location.host.indexOf("huawei.cn") > 0 ? "https://uniportal.huawei.cn":"https://uniportal.huawei.com";
    // 拉美官网退出登录地址
	if(window.location.host.indexOf("career.huawei.") >=0){
		//生产环境
		cm.config.logoutLAUrl = uniportalHost + "/uniportal1/logout?redirect=" + window.location.origin + "/reccampportal/la/index.html";
	}else if(window.location.host.indexOf("kwesit.huawei.") >=0){
		//测试环境   
		cm.config.logoutLAUrl = "https://uniportal-beta.huawei.com/uniportal1/logout?redirect=https://kwesit.huawei.com/reccampportal/la/index.html";
	}else{
		//本地环境
		cm.config.logoutLAUrl = "https://uniportal-beta.huawei.com/uniportal1/logout?redirect=https://kwesit.huawei.com/reccampportal/la/index.html";
	}
	var currentLanguage = '';
	$.i18nCache = $.i18nCache || {};
	$.i18nKeyp = function(key, data) {
		if(currentLanguage==null||currentLanguage=="")
		{
			currentLanguage= headerinfo.curlanguage;
		}

		if (key && $.i18nCache[key] && $.i18nCache[key][currentLanguage]) {
			var str = $.i18nCache[key][currentLanguage];
			// 处理参数
			if (str && data) {
				str = str.replace(/\{([^}]+)\}/img, function(str, val) {
					return data[val];
				});
			}
			return str;
		}
		return key;
	};
}(jQuery, window));

function isFunction(obj){
	if(obj && typeof obj =="function"){
		return true;
	}else{
		return false;
	}
}
/**
 * HW.Portal.Reccamp.Common - 公共函数
 */
(function(cm, win) {
	if (!cm) {
		console.log("HW.Portal.Reccamp.Common is null!");
		return;
	}
	cm.forword = function(url) {
		console.log(url);
		window.location = _encodeURI(url);
	};
	var _encodeURI = function(uri) {
		return encodeURI(uri);
	};
	// ajax
	cm.ajax = function(op) {
		var errorOld = op.error;
		op.error = function(xhr, textStatus, errorThrown) {
			// TODO 异常处理
			if (xhr.status == '403') {}
			if(xhr.responseText) {
				try{
					var response = JSON.parse(xhr.responseText);
					if (response && response.code == "huawei.rec.portal.10010009") {
						cm.login();
					}
					if(response && response.message) {
						xhr.message = response.message;
					}
				} catch (e) {
					console.error(e);
				}
			}
			errorOld && errorOld.call(this, xhr, textStatus, errorThrown);
		};
        var tenantId = ''
        if ('career.huawei.com,career.huawei.cn'.indexOf(window.location.hostname) >= 0) {
            tenantId = 'hcm'
        } else if ('kylin-sec.huawei.com'.indexOf(window.location.hostname) >= 0) {
            tenantId = 'hcm-secsit'
        } else {
            tenantId = 'hcm-uat'
        }
		op.beforeSend = function(xhr){
			if(headerinfo) {
				xhr.setRequestHeader("x-csrf-token", headerinfo.jalorSecurityToken);
			}
            xhr.setRequestHeader("x-jalor-tenantAlias", tenantId);
		}
        var csrfToken = ''
		if(window.headerinfo) {
			csrfToken = HW.Portal.Reccamp.Common.getJalorSecurityToken()
		}
		if (op.headers) {
			op.headers['x-csrf-token'] = csrfToken;
		} else {
			op.headers = {'x-csrf-token': csrfToken }
		}
        op.headers['x-jalor-tenantAlias'] = tenantId;
		var url = op.url;
		var hostName = win.location.hostname;
		var domiain = cm.config.hostname;
		if(hostName.indexOf(domiain) < 0){
			var topLevl= hostName.substring(hostName.lastIndexOf("."));
			domiain = ".huawei"+topLevl;
		}
		var reg=new RegExp("^/");
		if (url.indexOf(domiain) < 0 && !reg.test(url)) {
			op.url = cm.config.baseUrl + url;
		}
		var successOld = op.success;
		op.removeNull = op.removeNull || true;
		op.success = function(data) {
			var responseData = {};
			if((typeof data !="string") && (typeof data !="boolean") && (typeof data !="number")){
				data = data || {};
			}
			if(data && op.removeNull && (typeof data !="string") && (typeof data !="boolean") && (typeof data !="number")) {
				responseData = cm.removeNull(data);
			} else {
				responseData = data;
			}
			successOld && successOld(responseData);
		};
		if(op.type && (op.type.toLocaleUpperCase() == "POST" || op.type.toLocaleUpperCase() == "PUT") ) {
			op.contentType = op.contentType ||"application/json";
			if(op.data instanceof Object && op.contentType =="application/json") {
				op.data = JSON.stringify(op.data);
			}
		}
        // 官网缓存读取数据
        var hasCache = false;
        if(op.url && op.url.indexOf('/services/rec/baseTalent/pub/callNewHr') > 1) {
            var opDataJson = op.data && JSON.parse(op.data);
            // 获取LOOKUP缓存配置
            if(opDataJson && opDataJson.functionName) {
                opDataJson.language = opDataJson.language || headerinfo.curlanguage;
                // 缓存配置数据
                var cacheFunConf = cm.getLookup({code: "cache_callNewHr_Fun"});
                var cacheFunConfItem = null;
                var cacheFunConfList = cacheFunConf && cacheFunConf.data;
                var version = null;
                if(cacheFunConfList && cacheFunConfList.length) {
                    for(var index = 0;index < cacheFunConfList.length;index++) {
                        if(cacheFunConfList[index] && cacheFunConfList[index].itemCode == opDataJson.functionName) {
                            cacheFunConfItem = cacheFunConfList[index];
                        }
                        if(cacheFunConfList[index] && cacheFunConfList[index].itemCode == 'portalCacheVersion') {
                            version = cacheFunConfList[index].itemName || new Date().getTime;
                        }
                    }
                }
                if (cacheFunConfItem != null) {
                    var cacheKey = opDataJson.functionName + "_" + opDataJson.language;
                    cacheKey += cacheFunConfItem.itemAttr1 && opDataJson[cacheFunConfItem.itemAttr1] ? "_" + opDataJson[cacheFunConfItem.itemAttr1] : '';
                    cacheKey += cacheFunConfItem.itemAttr2 && opDataJson[cacheFunConfItem.itemAttr2] ? "_" + opDataJson[cacheFunConfItem.itemAttr2] : '';
                    cacheKey += cacheFunConfItem.itemAttr3 && opDataJson[cacheFunConfItem.itemAttr3] ? "_" + opDataJson[cacheFunConfItem.itemAttr3] : '';
                    cacheKey += cacheFunConfItem.itemAttr4 && opDataJson[cacheFunConfItem.itemAttr4] ? "_" + opDataJson[cacheFunConfItem.itemAttr4] : '';
                    cacheKey += cacheFunConfItem.itemAttr5 && opDataJson[cacheFunConfItem.itemAttr5] ? "_" + opDataJson[cacheFunConfItem.itemAttr5] : '';
                    cacheKey += cacheFunConfItem.itemAttr6 && opDataJson[cacheFunConfItem.itemAttr6] ? "_" + opDataJson[cacheFunConfItem.itemAttr6] : '';
                    var cacheResult = cacheResult = "undefined" == typeof portalCache ? null : portalCache.get(cacheKey,opDataJson.language,version);
                    if(cacheResult) {
                        var responseData = {};
                        if((typeof cacheResult !="string") && (typeof cacheResult !="boolean") && (typeof cacheResult !="number")){
                            cacheResult = cacheResult || {};
                        }
                        if(cacheResult && op.removeNull && (typeof cacheResult !="string") && (typeof cacheResult !="boolean") && (typeof cacheResult !="number")) {
                            responseData = cm.removeNull(cacheResult);
                        } else {
                            responseData = cacheResult;
                        }
                        hasCache = true;
                        successOld && successOld(responseData);
                    }
                }
            }
        }
        if(!hasCache) {
            $.ajax(op);
        }
	};
    /**
     * 返回jalorSecurityToken
     */
    cm.getJalorSecurityToken = function(){
        const result = headerinfo ? headerinfo.jalorSecurityToken : null;
        return result;
    }
	cm.removeNull = function(data) {
		if(!data) {
			return null;
		}
		var result = {};
		if (data instanceof Array) {
			result = [];
		}
		for(var i in data) {
			var item = data[i];
			if (item == null) {
				continue;
			}
			if (typeof item == "object") {
				result[i] = cm.removeNull(item);
			} else if (item || item === 0 || item ==="0") {
				result[i] = item;
			}
		}
		return result;
	};
    cm.getUrl = function (requestUrl) {
//		得到浏览器最新域名
        var host = window.location.hostname;
        var index = host.lastIndexOf(".");
        var str = host.substring(index);
//    	得到入参链接中的域名
        var requestHostStr = requestUrl.substr(requestUrl.indexOf("//") + 2);
        var tips = requestHostStr.indexOf("/");
        var url = requestUrl;
        if (tips > -1) {
            url = requestHostStr.substring(0, tips);
        }
        var lastLoc = url.lastIndexOf(".");
        var char = url.substring(lastLoc);
        url = requestUrl.replace(char, str);
        return url;
    }

    // 登录
    cm.login = function () {
        cm.sessionStorageSetItem("RecHeaderInfo", "0");
        cm.forword(cm.config.loginUrl + win.location.href);
    }
    // 注册
    cm.register = function () {
        var lang = headerinfo && headerinfo.curlanguage ? headerinfo.curlanguage : "zh_CN";
        var lochref = window.location.href;
        if (lochref.indexOf("career") >= 0) {
            cm.forword(cm.getUrl(cm.config.registerUrl) + lang + "&appurl=" + win.location.href);
        } else {
            cm.forword(cm.getUrl(cm.config.registerbetaUrl) + lang + "&appurl=" + win.location.href);
        }
    };
    // 退出
    cm.logout = function () {
        cm.sessionStorageSetItem("RecHeaderInfo", "0");
        if (window.headerinfo && window.headerinfo.user) {
            window.headerinfo.user = null;
        }
        location.href = "/reccampportal/servlet/logout";
    };
    // 拉美个人中心--退出登录
    cm.logoutOfLatinAmerica = function () {
		if(window.headerinfo && window.headerinfo.user){
			window.headerinfo.user=null;
		}
		location.href = cm.config.logoutLAUrl;
    };
	// 跳转至首页
	cm.goHome = function() {
		cm.forword(cm.config.baseUrl);
	};
	cm.localStorageSetItem = function(key, value) {
		if (!window.localStorage || !key) {
			return;
		}
		try {
			if (typeof value == "object") {
				value = JSON.stringify(value);
			}
		} catch (e){}
		localStorage[key] = value;
	};
	cm.localStorageGetItem = function(key) {
		if (!window.localStorage || !key) {
			return;
		}
		try {
			value = localStorage[key];
			value = JSON.parse(value);
		} catch (e) {
		}
		return value;
	};
	cm.sessionStorageSetItem = function(key, value) {
		if (!window.sessionStorage || !key) {
			return;
		}
		try {
			if (typeof value == "object") {
				value = JSON.stringify(value);
			}
		} catch (e){}
		sessionStorage[key] = value;
	};
	cm.sessionStorageGetItem = function(key) {
		if (!window.sessionStorage || !key) {
			return;
		}
		try {
			value = sessionStorage[key];
			value = JSON.parse(value);
		} catch (e) {
		}
		return value;
	};
	cm.getHeaderInfoTimeout =function (times) {
		times = times || 800;
		var timeoutGetHeaderInfo = cm.sessionStorageGetItem("timeoutGetHeaderInfo");
		if (timeoutGetHeaderInfo) {
			clearTimeout(timeoutGetHeaderInfo);
		}
		timeoutGetHeaderInfo = setTimeout(function(){
			cm.ajax({
				url : "servlet/getHeaderInfo?recruitType=rec&c=" + new Date().getTime(),
				async : false,
				success : function(data) {
					try {
						eval("var P" + data);
						if(Pheaderinfo) {
							cm.sessionStorageSetItem("RecHeaderInfo", Pheaderinfo);
						}
					} catch (e) {
						console.log("getHeaderInfo error" + e);
					}
				}
			});
		}, times);
		cm.sessionStorageSetItem("timeoutGetHeaderInfo", timeoutGetHeaderInfo);
	};
    // 获取HearderInfo
    var headerinfo;
    cm.getHeaderInfo = function () {
        headerinfo = cm.sessionStorageGetItem("RecHeaderInfo");
        if (headerinfo && headerinfo != "0" && !headerinfo.user) {
            headerinfo = null;
            cm.sessionStorageSetItem("RecHeaderInfo", null);
        }
        if (headerinfo && headerinfo != "0") {
            win.headerinfo = headerinfo;
            cm.getHeaderInfoTimeout(0);
            if (headerinfo.user) {
                cm.ajax({
                    url: "services/jalor/web/support/workspace/alone?c=" + new Date().getTime(),
                    async: false,
                    success: function (dd) {
                        headerinfo.jalorSecurityToken = dd.jalorSecurityToken;
                    }
                });
            }
            return headerinfo;
        } else {
            cm.ajax({
                url: "servlet/getHeaderInfo?recruitType=rec&c=" + new Date().getTime(),
                async: false,
                success: function (data) {
                    try {
                        eval(data);
                    } catch (e) {
                        console.log("getHeaderInfo error" + e);
                    }
                    if (headerinfo && headerinfo.user) {
                        cm.ajax({
                            url: "services/jalor/web/support/workspace/alone?c=" + new Date().getTime(),
                            async: false,
                            success: function (dd) {
                                headerinfo.jalorSecurityToken = dd.jalorSecurityToken;
                            }
                        });
                    }
                }
            });
            if (!headerinfo) {
                headerinfo = {};
            }
            if (win.headerinfo) {
                if (headerinfo.user) {
                    cm.sessionStorageSetItem("RecHeaderInfo", win.headerinfo);
                }
                return win.headerinfo;
            } else {
                return {
                    "status": "0",
                    "msg": "获取HeaderInfo失败！"
                };
            }
        }
    };
    cm.getHeaderInfo(); // 加载HeaderInfo
    cm.isLogined = function () {
        if (window.headerinfo && headerinfo.user) {
            return true;
        }
        return false;
    };
    // 切换语言
    cm.changeLanguage = function (language) {
        var resultData = {};
        if (language && language.language) {
            cm.sessionStorageSetItem("RecHeaderInfo", "0");
            cm.ajax({
                url: 'servlet/language?c=' + new Date().getTime(),
                async: false,
                data: {
                    switchTo: language.language
                },
                success: function (data) {
                    var exp = new Date();
                    exp.setTime(exp.getTime() + 1000 * 60 * 60 * 24 * 730);// 过期2年
                    document.cookie = "currentLanguage=" + data + ";expires=" + exp.toGMTString() + ";path=/";
                    window.localStorage.setItem('currentLanguage', data);
                    window.headerinfo.curlanguage = data;
                    /*setTimeout(function() {
                        cm.goHome();
                    }, 100);*/
                }
            });
            resultData.status = '1';
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
        return resultData;
    };
	// 获取当前语言
	cm.getCurlanguage = function() {
		if (win.headerinfo) {
                        if(win.headerinfo.curlanguage == 'zh_CN'){
                              return "zh_CN";
                        } else{
                              return "en_US";
                        }
		}
		return "zh_CN";
	};
	cm.checkuserishw = function()
	{
		//本地测试用的
		var lochref=window.location.href;
		if(lochref.indexOf("localhost")>=0){
			return false;
		}
		var userinfo = window.headerinfo;
		if(!userinfo){
			return false;
		}
		return !!userinfo.hwemp;
	};
	/**
	 * 获取用户身份
	 */
	window.portalGetUserTypeTime = 0;
	window.portalUserType = 0;

	cm.userAccountFlagTimeout =function () {
		var timeoutUserAccountFlagTimeout= cm.sessionStorageGetItem("timeoutUserAccountFlagTimeout");
		if (timeoutUserAccountFlagTimeout) {
			clearTimeout(timeoutUserAccountFlagTimeout);
		}
		timeoutUserAccountFlagTimeout = setTimeout(function(){
			if(window.headerinfo && headerinfo.user && headerinfo.user.userAccount){
				var userAccount = headerinfo.user.userAccount;
			}
			if (!userAccount) {
				return;
			}
			cm.ajax({
				url:"services/rec/baseTalent/pub/callNewHr",
				data: JSON.stringify({ "functionName": "resumeData_getUserType", "sys": "callNewCandidate", "userAccount": userAccount }),
				type: 'POST',
        success : function(data){
					if(data && data.data) {
						flag = data.data.userType;
						cm.sessionStorageSetItem("userAccountFlag", flag);
					}
				},
				error : function(data){
					console.log(JSON.stringify(data));
					if (data.status == 403 && window.headerinfo) {
						window.headerinfo.user = null;
					}
				}
			});
		}, 300);
		cm.sessionStorageSetItem("timeoutUserAccountFlagTimeout", timeoutUserAccountFlagTimeout);
	};

    cm.getUserType = function () {
        var flag = -1;
        var userAccount = "";
        /*var now = (new Date()).getTime();
        if(portalUserType != 0 && now - portalGetUserTypeTime < 5000) {
            return getSuccessMessage(portalUserType);
        }*/

        if (window.headerinfo && headerinfo.user && headerinfo.user.userAccount) {
            userAccount = headerinfo.user.userAccount;
        }
        if (userAccount) {
            var userAccountFlag;// = cm.sessionStorageGetItem("userAccountFlag");
            if (userAccountFlag && userAccountFlag != "99") {
                cm.userAccountFlagTimeout();
                flag = "" + userAccountFlag;
            } else {
                cm.ajax({
                    async: false,
                    url: "services/rec/baseTalent/pub/callNewHr",
                    data: JSON.stringify({ "functionName": "resumeData_getUserType", "sys": "callNewCandidate", "userAccount": userAccount }),
                    type: 'POST',
                    success: function (data) {
                        if (data && data.data) {
                            flag = data.data.userType;
                            cm.sessionStorageSetItem("userAccountFlag", flag);
                        }
                    },
                    error: function (data) {
                        console.log(JSON.stringify(data));
                    }
                });
            }
        }
        portalUserType = flag;
//		portalGetUserTypeTime = now;
        return getSuccessMessage(flag);
    };
    /**
     * 用户身份切换
     */
    cm.changeUserType = function (param) {
        var result = {};
        if (!param || !param.changeType || (param.changeType != "1" && param.changeType != "2")) {
            return getErrorMessage();
        }
        cm.sessionStorageSetItem("userAccountFlag", param.changeType);
        cm.ajax({
            async: false,
            type: "POST",
            url: "services/rec/baseTalent/pub/callNewHr",
            data: {
              'functionName': 'resumeData_userTypeChange',
              'sys': 'callNewCandidate',
              changeType: param.changeType,
              userAccount: headerinfo.user.userAccount
            },
            success: function (data) {
                result = getSuccessMessage();
            },
            error: function (e) {
                result = getErrorMessage();
            }
        });
        return result;
    };
	// 获取国家
	cm.getCountry = function(param,callback) {
		var resultData = {};
		var key = "RecGetCountry_" + cm.getCurlanguage();
		var value = cm.localStorageGetItem(key);
		/*
		if (value) {
			resultData = value;
			isFunction(callback) && callback(resultData);
			return resultData;
		}
		*/
		var paramData = {"functionName":"resumeData_getCountryData","sys":"callNewCandidate"};
        cm.ajax({
            url : 'services/rec/baseTalent/pub/callNewHr',
            type : 'post',
            data: JSON.stringify(paramData),
            async : isFunction(callback),
            success : function(data) {
                if (data && data.data) {
                    $.each(data.data, function(i, value){
                        if (value.countryCode == "China" && cm.getCurlanguage() == 'en_US') {
                            value.countryName = "China";
                        }
                    });
                    resultData.status = '1';
                    resultData.data = data.data;
                    isFunction(callback) && callback(resultData);
                    cm.localStorageSetItem(key, resultData);
                }
            },
            error : function(e) {
                resultData = getErrorMessage(e.message);
                isFunction(callback) && callback(resultData);
            }
        });
		return resultData;
	};
	// 获取学校所在省
	cm.queryStateLookup = function(param,callback) {
		if (param && param.countryCode) {
			var key = "RecQueryStateLookup_" + param.countryCode + "_" + cm.getCurlanguage();
			var value = cm.localStorageGetItem(key);
			/*
			if (value) {
				resultData = value;
				isFunction(callback) && callback(resultData);
				return resultData;
			}
			*/
			var resultData = {};
			cm.ajax({
				url : 'services/portal/portalpub/queryStateLookup/' + param.countryCode + "?language=" + cm.getCurlanguage(),
				type : 'get',
				async : isFunction(callback),
				success : function(data) {
					if (data && data.length > 0) {
						resultData.status = '1';
						resultData.data = data;
						cm.localStorageSetItem(key, resultData);
					} else {
						resultData.status = '99';
					}
					isFunction(callback) && callback(resultData);
				},
				error : function() {
					resultData.status = '0';
					resultData.msg = '获取省数据失败';
					isFunction(callback) && callback(resultData);
				}
			});
			return resultData;
		} else {
			return {
				"status": "0",
				"msg": "参数错误！"
			};
		}
	};
    // 获取学校所在地区
    cm.getCity = function (param, callback) {
        if (param && param.areaNames) {
            var resultData = {};
            var key = "RecGetCity_" + param.areaNames + "_" + cm.getCurlanguage();
            var value = cm.localStorageGetItem(key);
            /*
            if (value) {
                resultData = value;
                isFunction(callback) && callback(resultData);
                return resultData;
            }
            */
            cm.ajax({
                url: 'services/portal/portalpub/getCity?areaNames=' + param.areaNames + '&size=500&language=' + cm.getCurlanguage(),
                type: 'get',
                async: isFunction(callback),
                success: function (data) {
                    if (data && data.length > 0) {
                        resultData.status = '1';
                        resultData.data = data;
                    } else {
                        resultData.status = '99';
                    }
                    cm.localStorageSetItem(key, resultData);
                    isFunction(callback) && callback(resultData);
                },
                error: function () {
                    resultData.status = '0';
                    resultData.msg = '获取地区数据失败';
                    isFunction(callback) && callback(resultData);
                }
            });
            return resultData;
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
    // 期望面试地
    cm.getInterviewProvinceAsync = function (param, callback) {
        /*if (param && param.nationalityCode == 'PQH_CN') {
            return cm.queryStateLookup(param);
        } else */
        if (param && param.nationalityCode && param.countryCode) {
            var resultData = {};
            var key = "RecGetInterviewProvinceAsync_" + param.nationalityCode + "_" + param.countryCode + "_" + cm.getCurlanguage();
            var value = cm.localStorageGetItem(key);
            /*
            if (value) {
                resultData = value;
                isFunction(callback) && callback(resultData);
                return resultData;
            }
            */
            cm.ajax({
                url: 'services/rec/baseTalent/country/queryStateListLookup?nationalityCode=' + param.nationalityCode + '&countryOfSchoolCode=' + param.countryCode + '&language=' + cm.getCurlanguage(),
                type: 'get',
                async: true,
                success: function (data) {
                    if (data && data.length > 0) {
                        resultData.status = '1';
                        var interviewProvinces = [];
                        for (var i = 0; i < data.length; i++) {
                            var interviewProvince = {};
                            interviewProvince.itemCode = data[i].itemCode;
                            interviewProvince.itemName = data[i].itemName;
                            interviewProvinces.push(interviewProvince);
                        }
                        resultData.data = interviewProvinces;
                        cm.localStorageSetItem(key, resultData);
                    } else {
                        resultData.status = '99';
                    }
                    callback && callback(resultData);
                },
                error: function () {
                    resultData.status = '0';
                    resultData.msg = '获取期望面试地数据失败';
                    callback && callback.call(resultData);
                }
            });
//			return resultData;
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
    // 期望面试地
    cm.getInterviewProvince = function (param, callback) {
        /*if (param && param.nationalityCode == 'PQH_CN') {
            return cm.queryStateLookup(param);
        } else */
        if (param && param.nationalityCode && param.countryCode) {
            var resultData = {};
            var key = "RecGetInterviewProvince_" + param.nationalityCode + "_" + param.countryCode + "_" + cm.getCurlanguage();
            var value = cm.localStorageGetItem(key);
            /*
            if (value) {
                resultData = value;
                isFunction(callback) && callback(resultData);
                return resultData;
            }*/
            cm.ajax({
                url: 'services/rec/baseTalent/country/queryStateListLookup?nationalityCode=' + param.nationalityCode + '&countryOfSchoolCode=' + param.countryCode + '&language=' + cm.getCurlanguage(),
                type: 'get',
                async: isFunction(callback),
                success: function (data) {
                    if (data && data.length > 0) {
                        resultData.status = '1';
                        var interviewProvinces = [];
                        for (var i = 0; i < data.length; i++) {
                            var interviewProvince = {};
                            interviewProvince.itemCode = data[i].itemCode;
                            interviewProvince.itemName = data[i].itemName;
                            interviewProvinces.push(interviewProvince);
                        }
                        resultData.data = interviewProvinces;
                        cm.localStorageSetItem(key, resultData);
                    } else {
                        resultData.status = '99';
                    }
                    isFunction(callback) && callback(resultData);
                },
                error: function () {
                    resultData.status = '0';
                    resultData.msg = '获取期望面试地数据失败';
                    isFunction(callback) && callback(resultData);
                }
            });
            return resultData;
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
    //期望面试城市显示逻辑
    cm.isShowInterviewCity = function (param) {
        var ret = cm.getLookup({code: "expectation_interview_location"})
        if (param && param.areaNames) {
            var state = param.areaNames;
            var locs = ret.data
            var isExist = false;
            for (var i = 0; i < locs.length; i++) {
                var loc = locs[i];
                if (loc.itemCode == state) {
                    if (loc.itemAttr1 != "1") {
                        isExist = true;
                        break;
                    }
                }
            }
            if (isExist && state != "other") {
                return getSuccessMessage("1")//不显示
            } else {
                if (state == "other" || state == "AustraliaOC" || state == "CanadaOC" || state == "AmericaOC" || state == "Europe" || state == "JapanOC") {
                    return getSuccessMessage("2");//输入框
                } else {
                    return getSuccessMessage("3");//下拉框
                }
            }
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
    //海外本地期望面试城市显示逻辑
    cm.isShowLocalHiringInterviewCity = function (param) {
        var ret = cm.getLookup({code: "expectation_interview_location"})
        if (param && param.areaNames) {
            var state = param.areaNames;
            var locs = ret.data
            var isExist = false;
            for (var i = 0; i < locs.length; i++) {
                var loc = locs[i];
                if (loc.itemCode == state) {
                    if (loc.itemAttr1 != "1") {
                        isExist = true;
                        break;
                    }
                }
            }
            if (isExist || (state.indexOf('PQH') != -1)) {
                return getSuccessMessage("1")//不显示
            } else {
                if (state == "other" || state == "AustraliaOC" || state == "CanadaOC" || state == "AmericaOC" || state == "Europe" || state == "JapanOC") {
                    return getSuccessMessage("2");//输入框
                } else {
                    return getSuccessMessage("3");//下拉框
                }
            }
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
	// 获取Lookup
	cm.getLookup = function(lookup) {
		var result = {};
		if (lookup.code == 'PORTAL_INTENT_DEPT_ORDER' && headerinfo.curlanguage =='zh_CN') {
			result.data = [{"itemId":11188,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"047285/网络产品与解决方案/Network Products & Solutions","itemCode":"047285"},{"itemId":11189,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"023338/2012实验室/2012 Laboratories","itemCode":"023338"},{"itemId":11190,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"047294/Cloud & AI产品与服务/Cloud & AI Products & Services","itemCode":"047294"},{"itemId":11191,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"024879/海思半导体与器件业务部/Hisilicon Semiconductor and Component Business Dep","itemCode":"024879"},{"itemId":11192,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"034476/消费者BG/Consumer Business Group","itemCode":"034476"},{"itemId":11193,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"048459/智能汽车解决方案BU/Intelligent Automotive Solution BU","itemCode":"048459"}];
			result.status = '1';
			return result;
		}else if(lookup.code == 'PORTAL_INTENT_DEPT_ORDER' && !headerinfo.curlanguage =='zh_CN'){
			result.data = [{"itemId":11188,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"047285/网络产品与解决方案/Network Products & Solutions","itemCode":"047285"},{"itemId":11189,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"023338/2012实验室/2012 Laboratories","itemCode":"023338"},{"itemId":11190,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"047294/Cloud & AI产品与服务/Cloud & AI Products & Services","itemCode":"047294"},{"itemId":11191,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"024879/海思半导体与器件业务部/Hisilicon Semiconductor and Component Business Dep","itemCode":"024879"},{"itemId":11192,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"034476/消费者BG/Consumer Business Group","itemCode":"034476"},{"itemId":11193,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_ORDER"},"itemName":"048459/智能汽车解决方案BU/Intelligent Automotive Solution BU","itemCode":"048459"}];
			result.status = '1';
			return result;
		}
		if (lookup.code == 'PORTAL_INTENT_DEPT_LEVEL' && headerinfo.curlanguage =='zh_CN') {
			result.data = [{"itemId":10886,"classify":{"classifyCode":"PORTAL_INTENT_DEPT_LEVEL"},"itemName":"024879/海思半导体与器件业务部/Hisilicon Semiconductor and Component Business Dept","itemAttr1":"1","itemCode":"024879"}];
			result.status = '1';
			return result;
		}else if (lookup.code == 'PORTAL_INTENT_DEPT_LEVEL' && !headerinfo.curlanguage =='zh_CN'){
			result.data =[{"classify":{"classifyCode":"PORTAL_INTENT_DEPT_LEVEL"},"itemName":"024879/海思半导体与器件业务部/Hisilicon Semiconductor and Component Business Dept","itemId":10887,"itemAttr1":"1","itemCode":"024879"}];
			result.status = '1';
			return result;
		}
		if (win.lookupListCache && win.lookupListCache && win.lookupListCache[lookup.code + "_&_"]) {
			if (win.lookupListCache[lookup.code + "_&_"]) {
				result.status = '1';
				result.data = win.lookupListCache[lookup.code + "_&_"];
			} else {
				result.status = '99';
			}
			return result;
		} else {
			var url = "services/portal/portalpub/list/lang/"+lookup.code;
			if(lookup.code == 'PORTAL_INTENT_DEPT_LEVEL' || lookup.code == 'PORTAL_INTENT_DEPT_ORDER'){
				url = "services/portal/portalpub/pub/list/lang/" + cm.getCurlanguage() + "/"+lookup.code;
			}
			win.lookupCache = win.lookupCache || {};
			win.lookupListCache = win.lookupListCache || {};
			cm.ajax({
				url : url,
				async : false,
				data : '',
				success : function(data) {
					if (data && data.length > 0) {
                        var key = lookup.code;
                        var cacheKey ="" + key + "_&_";
                        var map = lookupCache[cacheKey];
                        if (!map) {
                            map = {};
                            var datas = data;
                            for (var i = 0; i < datas.length; i++) {
                                map[datas[i].itemCode] = datas[i].itemName;
                            }
                            lookupListCache[cacheKey] = datas;
                            lookupCache[cacheKey] = map;
                        }
					}
				}
			});
			if (win.lookupListCache[lookup.code + "_&_"]) {
				result.status = '1';
				result.data = win.lookupListCache[lookup.code + "_&_"];
			} else {
				result.status = '99';
			}
			return result;
		}
	};
	var getLookupList = function (key,data){
		if(data && key){
			var dataList = new Array();
			for(var i=0; i<data.length;i++){
				if(data[i].classify.classifyCode == key){
					dataList.push(data[i]);
				}
			}
			return dataList;
		}
		return {};
	};
	// 根据国家code返回毕业院校
	// services/rec/baseTalent/country/attr/list/ET/China
    cm.getEstablishment = function (param, callback) {
        if (param && param.countryCode) {
            var resultData = {};
            var key = "RecGetEstablishment_" + param.countryCode + "_" + cm.getCurlanguage();
            var value = cm.localStorageGetItem(key);
            /*
            if (value) {
                resultData = value;
                isFunction(callback) && callback(resultData);
                return resultData;
            }
            */
            var url = 'services/rec/baseTalent/country/attr/list/ET/';
            if (cm.isLogined()) {
                url = 'services/rec/baseTalent/country/cach/attr/list/ET/';
            }
            cm.ajax({
                url: url + param.countryCode + "?language=" + cm.getCurlanguage(),
                type: 'get',
                async: isFunction(callback),
                success: function (data) {
                    if (data && data.length > 0) {
                        resultData.status = '1';
                        resultData.data = data;
                    } else {
                        resultData.status = '99';
                    }
                    cm.localStorageSetItem(key, resultData);
                    isFunction(callback) && callback(resultData);
                },
                error: function () {
                    resultData.status = '0';
                    resultData.msg = '获取毕业院校数据失败';
                    isFunction(callback) && callback(resultData);
                }
            });
            return resultData;
        } else {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
    };
    // 获取籍贯
    // services/rec/baseTalent/country/attr/list/ET/China
    cm.getNativePlace = function (param, callback) {
        var resultData = {};
        var key = "RecGetNativePlace_China_" + cm.getCurlanguage();
        var value = cm.localStorageGetItem(key);
        /*
        if (value) {
            resultData = value;
            isFunction(callback) && callback(resultData);
            return resultData;
        }
        */
        cm.ajax({
            url: "services/portal/portaluser/getArea?area=China&language=" + cm.getCurlanguage(),
            type: 'get',
            async: isFunction(callback),
            success: function (data) {
                if (data && data.length > 0) {
                    resultData.status = '1';
                    resultData.data = data;
                    cm.localStorageSetItem(key, resultData);
                } else {
                    resultData.status = '99';
                }
                isFunction(callback) && callback(resultData);
            },
            error: function () {
                resultData.status = '0';
                resultData.msg = '获取籍贯数据失败';
                isFunction(callback) && callback(resultData);
            }
        });
        return resultData;
    };
    //获取附件下载地址
    cm.getUploadFileInfo = function (param, callback) {
        if (!param || !param.attType || !param.attachmentId) {
            return {
                "status": "0",
                "msg": "参数错误！"
            };
        }
        var resultData = {};
        cm.ajax({
            url: "services/portal/portaluser/attachment/findFile/" + param.attType + "/" + param.attachmentId + "?id=001",
            type: 'get',
            async: isFunction(callback),
            success: function (data) {
                if (data && data.downloadUrl) {
                    resultData.status = '1';
                    data.downloadUrl = cm.config.baseUrl + data.downloadUrl
                    resultData.data = data;
                } else {
                    resultData.status = '99';
                }
                isFunction(callback) && callback(resultData);
            },
            error: function () {
                resultData.status = '0';
                resultData.msg = '获取附件下载地址失败';
                isFunction(callback) && callback(resultData);
            }
        });
        return resultData;
    };
    cm.getAllImage = function () {
        win.imgageConfs = {};
        cm.ajax({
            async: false,
            url: 'services/rec/portal/adConf/getAll',
            type: 'GET',
            success: function (data) {
                win.imgageConfs = data;
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
    };
    cm.loadAdImg = function (param) {
        var module = param.module;
        var type = param.type;
        var number = param.number || 1;
        if (!module || !type || !number) {
            return getMessage("0", $.i18nKeyp("portal.items.require"));
        }
        if (!win.imgageConfs || win.imgageConfs.length <= 0) {
            cm.getAllImage();
        }
        var datas = win.imgageConfs.adConfVOList.filter(function (x) {
            return x.homeModule === module && x.adTypeCode === type;
        });
        if (datas.length > number) {
            datas = datas.slice(0, number);
        }
        return getSuccessMessage(datas);
    };
    /**
     * 简历状态
     */
    cm.getResumeLockSatus = function (param) {
        var result = {};
        if (window.location.href.indexOf("campus-recruitment-detail.html") < 0 && window.location.href.indexOf("appjob-campus.html") < 0) {
            result.status = '1';
            result.data = '2';
            return result;
        }
        //必填数据校验
        cm.ajax({
            url: 'services/portal/portaluser/pro/getResumeLockSatus?recruitType=CR&classification=' + param.classification + (param && param.jobId ? "&jobId=" + param.jobId : ""),
            type: 'GET',
            async: false,
            success: function (data) {
                result = getSuccessMessage(data);
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 候选人应聘状态
    */
    cm.getCandidateApplicationSatus = function (param) {
        var result = {};
        var tenantId = ''
        if ('career.huawei.com,career.huawei.cn'.indexOf(window.location.hostname) >= 0) {
            tenantId = 'hcm'
        } else if ('kylin-sec.huawei.com'.indexOf(window.location.hostname) >= 0) {
            tenantId = 'hcm-secsit'
        } else {
            tenantId = 'hcm-uat'
        }
        cm.ajax({
            async: false,
            url: "servlet/proxy/params/newRecruitment",
            data: JSON.stringify(param),
            contentType: "application/json",
            headers: {'x-jalor-tenantAlias': tenantId},
            type: 'POST',
            success: function (data) {
               result = getSuccessMessage(data);
            },
            error: function (e) {
               result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
   * 社招官网下线，对于未转发到新招聘的服务,如果需要转发到新招聘,通过统一服务转发
   */
  cm.newHr = function (param) {
    var result = {};
    var tenantId = ''
    if ('career.huawei.com,career.huawei.cn'.indexOf(window.location.hostname) >= 0) {
        tenantId = 'hcm'
    } else if ('kylin-sec.huawei.com'.indexOf(window.location.hostname) >= 0) {
        tenantId = 'hcm-secsit'
    } else {
        tenantId = 'hcm-uat'
    }
    cm.ajax({
      async: false,
      url: "services/rec/baseTalent/pub/callNewHr",
      data: JSON.stringify(param),
      contentType: "application/json",
      headers: { 'x-jalor-tenantAlias': tenantId },
      type: 'POST',
      success: function (data) {
        result = getSuccessMessage(data);
      },
      error: function (e) {
        result = getErrorMessage(e.message);
      }
    });
    return result;
  }
  /**
   * 官网缓存数据获取
   */
    cm.getCacheList = function(cacheKey,language,version) {
        if (win.recPortalCache && win.recPortalCache["reccampportal_cache_" + language]) {
            return win.recPortalCache[cacheKey + "_" + language];
        }
        version = version || new Date().getTime();
        win.recPortalCache = win.recPortalCache || {};
        var result = {};
        cm.ajax({
            async: false,
            url: "reccampportal_cache_" + language + ".js?v=" + version,
            data: '',
            contentType: "application/json",
            type: 'GET',
            success: function (data) {
              result = data;
              win.recPortalCache["reccampportal_cache_" + language] = data;
            },
            error: function (e) {
              result = null;
            }
        });
        return result;
    }
}(HW.Portal.Reccamp.Common, window));

/**
 * HW.Portal.Reccamp.Resume
 */
(function(hr, cm,win) {
	if (!hr) {
		console.log("HW.Portal.Reccamp.Resume is null!");
		return;
	}
	/**
	 * 时间校验
	 */
	var checkDate = function(startDate,endDate){
		if(!startDate || !endDate){
			return false;
		}
		if(new Date(startDate).getTime() >= new Date(endDate).getTime() ){
			return false;
		}
		return true;
	}
	/**
	 * 查看简历信息
	 */
	hr.queryResumeSubInfo = function(param,callback){
		var result = {};
		cm.ajax({
			url : 'services/portal/portaluser/findResumeInfo',
			type : 'get',
			async : isFunction(callback),
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error:function(e){
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
    /**
     * 获取隐私数据保护承诺
     */
    hr.getDataCommitment = function (param, callback) {
        var result = {};
        cm.ajax({
            url: 'services/rec/baseTalent/pub/callNewHr',
            type: 'post',
            data: {
              "functionName": "socRecruit_operatePrivacyNewHr",
              "sys": "callNewCandidate",
              "declarationNo": "career.huawei.com,career.huawei.cn".indexOf(window.location.hostname) >= 0 ? "PSTZHCN" : "PSTB",
              "dataSource": "1",
              "language": headerinfo.curlanguage || "zh_CN",
              "serviceMethodName": "queryPrivacySignedContent"
              },
            async: isFunction(callback),
            success: function (data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error: function (e) {
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }


    /**
     * 获取隐私数据保护承诺
     */
    hr.getDataCommitmentMexico = function(param,callback){
        var result = {};
        cm.ajax({
            url : 'services/rec/baseTalent/pub/callNewHr',
            type : 'post',
            async : isFunction(callback),
            data: {
              "functionName": "socRecruit_operatePrivacyNewHr",
              "sys": "callNewCandidate",
              "declarationNo": "PRIVACYMEXICO",
              "dataSource": "1",
              "language": param.lang,
              "serviceMethodName": "queryPrivacySignedContent"
              },
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 保存隐私数据保护承诺
     */
    hr.saveDataCommitment = function (formData) {
        if (!formData || !formData.noticeId) {
            return getErrorMessage("参数noticeId不能为空!");
        }
        var result = {};
        cm.ajax({
            async: false,
            url: 'services/portal/portaluser/saveDataCommitment',
            data: JSON.stringify(formData),
            contentType: "application/json",
            type: 'POST',
            success: function (data) {
                result = getSuccessMessage(data);
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 获取隐私数据保护承诺（支持未登录调用）
     */
    hr.getRecommendPrivacyData = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/privacy/data/' + param.lang,
            type : 'get',
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 根据edocId获取简历解析的taskId
     */
    hr.getEdmParseByEdocId = function(param,callback){
        let result = {};
        cm.ajax({
            url : `/reccampportal/servlet/edmParse?edocId=${param.edocId}`,
            type : 'post',
			cache: false,
			processData: false,
			dataType: "json",
			contentType: false,
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 登陆后绑定account和edmid
     */
    hr.bindEdmidInLogin = function(param,callback){
        let result = {};
        cm.ajax({
            url : `/reccampportal/services/portal/recommend/privacy/bindEdmidInLogin`,
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 根据账号和类型获取最新AI推荐记录
     */
    hr.getLastRecommends = function(param,callback){
        let result = {};
        cm.ajax({
            url : `/reccampportal/services/portal/recommend/record/getLastRecommends`,
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 已登录用户手动获取推荐信息
     */
    hr.queryRecommendByStructuredResume = function(param,callback){
        let result = {};
        cm.ajax({
            url : `/reccampportal/services/portal/recommend/queryRecommendByStructuredResume`,
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = data;
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 查询推荐记录（职位信息）
     */
    hr.getJobRecommendRecord = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/record',
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 保存岗位推荐浏览纪录
     */
    hr.setJobRecommendBrowse = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/job/browse',
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 保存岗位推荐投递纪录
     */
    hr.setJobRecommendDelivery = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/job/delivery',
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 保存岗位投递来源
     */
    hr.setJobApplySource = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/job/apply/source',
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }

    /**
     * 请求token，是否展示上传模块
     */
    hr.getRecommendLicense = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/getRecommendLicense',
            type : 'get',
            data: param,
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
 
    /**
     * AI职位推荐是否需要刷新岗位
     */
    hr.checkRefreshRecommend = function(param,callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/check/refresh',
            type : 'post',
			data: JSON.stringify(param),
			contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * 免登陆获取lookup信息
     */
    hr.freeLoginGetLookupData = function(param, callback){
        let result = {};
        cm.ajax({
            url : "services/portal/portalpub/pub/list/lang/" + cm.getCurlanguage() + '/' + param.code,
            type : 'get',
            contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * AI职位获取评价tips配置(好评配置)
     */
    hr.getEvaluationGoodTipsOptions = function(param, callback){
        let result = {};
        cm.ajax({
            url : "services/portal/portalpub/pub/list/lang/" + cm.getCurlanguage() +'/appraise_good_reason',
            type : 'get',
            contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * AI职位获取评价tips配置(差评配置)
     */
    hr.getEvaluationTipsOptions = function(param, callback){
        let result = {};
        cm.ajax({
            url : "services/portal/portalpub/pub/list/lang/" + cm.getCurlanguage() +'/appraise_bad_reason',
            type : 'get',
            contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * AI职位推荐点赞点踩
     */
    hr.addRecommendAppraise = function(param, callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/addAppraise',
            type : 'post',
            data: param,
            contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * AI简历解析-推荐结果
     */
    hr.getRecommendTaskResult = function(param, callback){
        let result = {};
        cm.ajax({
            url : 'services/portal/recommend/task/result',
            type : 'post',
			data: JSON.stringify(param),
            contentType: "application/json",
            async : isFunction(callback),
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error:function(e){
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    
	/**
	 * 查询简历基本资料
	 */
    hr.queryResumeBaseInfo = function (params, callback) {
        var md5Id = ''
        if (params && params.md5Id) {
            md5Id = params.md5Id;
        }
        var result = {};
        cm.ajax({
            url: 'services/rec/baseTalent/pub/callNewHr',
            type: 'post',
            async: isFunction(callback),
            data: {"functionName": "resumeData_findCenterResume", "sys": "callNewChannel", "recruitType": "rec", "putResumeId": "1", md5Id: md5Id},
            success: function (data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
            },
            error: function (e) {
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
    }
    /**
     * 保存简历基本资料
     */
    hr.saveResumeBaseInfo = function (formData) {
        if (!formData || !formData.name || !formData.title || !formData.nationality || !formData.email
            || !formData.telephoneTitle || !formData.mobilePhone || !formData.countryOfSchool || !formData.photoAttachmentId
            || (formData.nationality == 'PQH_CN' && (!formData.indentifiedId || !formData.indentifiedType))) {
            return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
        }
        if (formData.birthDateStr) {
            var age = Math.floor((new Date() - new Date((formData.birthDateStr || '').replace('-', '/'))) / 1000 / 60 / 60 / 24 / 365);//计算生日
            if (age < 16 || age > 80) {
                //出生日期填写异常，请核对后重新输入
                return getErrorMessage($.i18nKeyp("portal.resumeManager.validBirthDate"));
            }
        }
        if (formData.highestDegree && formData.highestDegree == 'Doctor') {//当最高学历为博士时，设置招聘类型为2博士，0校招
            formData.resumeType = 2;
        } else {
            formData.resumeType = 0;
        }
        if (formData.nationality != 'PQH_CN' && formData.countryOfSchool != 'China') {
            formData.schoolOrInterviewLocus = 'other';
            formData.schoolOrInterviewCity = formData.interviewProvince;
        }
        var result = {};
        formData.field3 = formData.tohomecountry;
        formData.field4 = formData.chineselevel;
        if (!formData.resumeId) {
            var resumeData = null;
            var cloneFormData = JSON.parse(JSON.stringify(formData))
            cloneFormData.functionName = "validSameResume";
            cloneFormData.sys = "callNewCandidate";
            cloneFormData.recruitType = "rec";
            cm.ajax({
                async: false,
                url: "services/rec/baseTalent/pub/callNewHr",
                data: JSON.stringify(cloneFormData),
                contentType: "application/json",
                type: 'POST',
                success: function (data) {
                    resumeData = data;
                },
                error: function (e) {
                    return getErrorMessage(e.message);
                }
            });
            if (resumeData && resumeData.status && resumeData.status != 0) {
                if (resumeData.status == "1") {
                    result = getErrorMessage($.i18nKeyp("portal.certificate.duplicated"));
                } else if (resumeData.status == "2") {
                    result = getErrorMessage($.i18nKeyp("portal.email.duplicated"));
                } else if (resumeData.status == "3") {
                    result = getErrorMessage($.i18nKeyp("portal.phone.duplicated"));
                } else {
                    getErrorMessage(resumeData.msg);
                }
                return result;
            }
        }
        // 解决注册简历，第一次同意隐私并勾选后，保存简历基本信息，是否接受承诺字段为空。导致再次编辑还需要同意一次签署隐私
        if (!formData.commitmentLetterId) {
			var privacy = hr.getDataCommitment();
			if (privacy && privacy.status == '1') {
				formData.commitmentLetterId = privacy.data.noticeId || '';
			}
		}
        if (formData.countryOfSchool && formData.countryOfSchool !== 'China') {
            // 当前学校所在国家/地区选择海外国家
            formData.interviewProvince = formData.interviewProvince || formData.schoolOrInterviewLocus
            formData.interviewCity = formData.interviewCity || formData.schoolOrInterviewCity
        }
        cm.ajax({
            async: false,
            url: 'services/portal/portaluser/saveResumeInfo/newHr',
            data: JSON.stringify(formData),
            contentType: "application/json",
            type: 'PUT',
            success: function (data) {
                result = getSuccessMessage(data);
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    //校验身份证是否存在
    hr.isTalentExistByIdCard = function (formData, callback) {
        var result = getSuccessMessage();
        isFunction(callback) && callback(result);
        return result;
    }
    /**
     * 注册验证是否存在相同简历
     */
    hr.validSameResume = function (formData) {
        var result = {};
        cm.ajax({
            async: false,
            url: "services/rec/baseTalent/pub/callNewHr",
            data: JSON.stringify(formData),
            contentType: "application/json",
            type: 'POST',
            success: function (data) {
                result = data;
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    hr.sendVerificationCode = function (formData) {
        var result = {};
        cm.ajax({
            async: false,
            url: "services/rec/baseTalent/pub/callNewHr",
            data: JSON.stringify(formData),
            contentType: "application/json",
            type: 'POST',
            success: function (data) {
                result = data;
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    hr.submitVerificationCode = function (formData) {
        var result = {};
        formData.type = "1";
        var data = JSON.stringify(formData);
        cm.ajax({
            async: false,
            url: "services/rec/baseTalent/pub/callNewHr",
            data: data,
            contentType: "application/json",
            type: 'POST',
            success: function (data) {
                result = data;
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    hr.manualRetrieval = function (formData) {
        var result = {};
        formData.type = "2";
        var data = JSON.stringify(formData);
        cm.ajax({
            async: false,
            url: "services/rec/baseTalent/pub/callNewHr",
            data: data,
            contentType: "application/json",
            type: 'POST',
            success: function (data) {
                result = data;
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑工作意向
     */
    hr.updateIntention = function (formData) {
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/saveIntentionInfo',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 新增教育经历
     */
    hr.createEducation = function (formData) {
        //校验结束时间必须大于开始时间
        if (!checkDate(formData.educationStartDateStr, formData.educationEndDateStr)) {
            return getMessage("0", "教育经历起止时间填写有误");
        }
        var result = {};
		if(formData && formData.isStrBoBorn=="1"){
			window.isStrBoBorn = "1";
		}
        //保存数据
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentResumeEduVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑教育经历
     */
    hr.updateEducation = function (formData) {
        //校验结束时间必须大于开始时间
        for(var i = 0; i < formData.length; i++){
			if(!checkDate(formData[i].educationStartDateStr,formData[i].educationEndDateStr)){
				return getMessage("0","教育经历起止时间填写有误");
			}
		}
        var result = {};
        var csrfToken = ''
		if(window.headerinfo) {
			csrfToken = HW.Portal.Reccamp.Common.getJalorSecurityToken()
		}
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentResumeEduVO/newHr',
            type: 'put',
            async: false,
            headers: { 'x-csrf-token': csrfToken },
            data: {items2Update: formData},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除教育经历
     */
    hr.deleteEducation = function (formData) {
        //判断主键id是否为空
        if (!formData.eduId) {
            return getMessage("0", "教育经历eduId为空");
        }
        var result = {};
        //校验经历必须 保留一条
        // cm.ajax({
        //     url: 'services/portal/portaluser/pro/findTalentResumeEduList',
        //     type: 'get',
        //     async: false,
        //     data: "",
        //     success: function (data) {
        //         if (data && data.length == 1) {
        //             result = getMessage("0", "请至少保留一条教育经历信息");
        //         }
        //     },
        //     error: function (e) {
        //         result = getErrorMessage(e.message);
        //     }
        // });
        // if (result.status) {
        //     return result;
        // }
        //数据保存
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentResumeEduVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

	/**
	 * 新增语言能力
	 */
    hr.createLanguage = function (formData) {
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentLanguageVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 编辑语言能力
     */
    hr.updateLanguage = function (formData) {
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentLanguageVO/newHr',
            type: 'put',
            async: false,
            data: {items2Update: formData},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 删除语言能力
     */
    hr.deleteLanguage = function (formData) {
        //判断主键id是否为空
        if (!formData.languageId) {
            return getMessage("0", "语言languageId为空");
        }
        //数据保存
        var items2Delete = [];
        items2Delete.push(formData);
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentLanguageVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增家庭成员
     */
    hr.createFamily = function (formData) {
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentContactVO',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 编辑家庭成员
     */
    hr.updateFamily = function (formData) {
        //判断主键id是否为空
        if (!formData.contactId) {
            return getMessage("0", "家庭成员contactId为空");
        }
        //保存数据
        var items2Update = [];
        items2Update.push(formData);
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentContactVO',
            type: 'put',
            async: false,
            data: {items2Update: items2Update},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 删除家庭成员
     */
    hr.deleteFamily = function (formData) {
        //判断主键id是否为空
        if (!formData.contactId) {
            return getMessage("0", "家庭成员contactId为空");
        }
        //数据保存
        var items2Delete = [];
        items2Delete.push(formData);
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentContactVO',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增工作经历
     */
    hr.createPractice = function (formData) {
        //校验结束时间必须大于开始时间
        if (!checkDate(formData.startDateStr, formData.endDateStr)) {
            return getMessage("0", "工作经历起止时间填写有误");
        }
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentEmployerVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 编辑工作经历
     */
    hr.updatePractice = function (formData,resumeId) {
		//校验结束时间必须大于开始时间
		for (var i = 0; i < formData.length; i++) {
			if(!checkDate(formData[i].startDateStr,formData[i].endDateStr)){
				return getMessage("0","工作经历起止时间填写有误");
			}
		}
        var result = {};
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentEmployerVO/newHr',
            type: 'put',
            data: params,
            async: false,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 删除工作经历
     */
    hr.deletePractice = function (formData) {
        //判断主键id是否为空
        if (!formData.preId) {
            return getMessage("0", "工作经历preId为空");
        }
        var result = {};
        //数据保存
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentEmployerVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增获奖情况
     */
    hr.createPrize = function (formData) {
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertResumePrizeVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     *编辑获奖情况
     */
    hr.updatePrize = function (formData, resumeId) {
        var result = {};
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePrizeVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除获奖情况
     */
    hr.deletePrize = function (formData) {//数据保存
        //判断主键id是否为空
        if (!formData.prizeId) {
            return getMessage("0", "获奖情况prizeId为空");
        }
        var items2Delete = [];
        items2Delete.push(formData);
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePrizeVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

	/**
	 * 新增项目奖励
	 */
    hr.createProject = function (formData) {
        //校验结束时间必须大于开始时间
        if (!checkDate(formData.startDateStr, formData.endDateStr)) {
            return getMessage("0", "项目经历起止时间填写有误");
        }
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentProjectExpVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 编辑项目奖励
     */
    hr.updateProject = function (formData, resumeId) {
		//校验结束时间必须大于开始时间
		for (var i = 0; i < formData.length; i++) {
			if(!checkDate(formData[i].startDateStr,formData[i].endDateStr)){
				return getMessage("0","项目经历起止时间填写有误");
			}
		}
        
        var result = {};
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentProjectExpVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 删除项目奖励
     */
    hr.deleteProject = function (formData) {
        //判断主键id是否为空
        if (!formData.projectId) {
            return getMessage("0", "项目经历projectId为空");
        }
        //数据保存
        var items2Delete = [];
        items2Delete.push(formData);
        var result = {};
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentProjectExpVO/newHr',
            type: 'put',
            data: {items2Delete: items2Delete},
            async: false,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }


    /**
     * 新增发表论文
     */
    hr.createThesis = function (formData) {
        var result = {};
        //必填验证
        if (!formData || !formData.paperName || !formData.paperParticulars || !formData.paperTimeStr) {
            return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertResumePaperVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑发表论文
     */
    hr.updateThesis = function (formData, resumeId) {
        var result = {};
				for (var i = 0 ; i < formData.length; i++) {
					//必填校验
					if(!formData[i].paperName || !formData[i].paperParticulars || !formData[i].paperTimeStr){
						return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
					}
				}
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePaperVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除发表论文
     */
    hr.deleteThesis = function (formData) {
        var result = {};
        //判断主键id是否为空
        if (!formData.paperId) {
            return getMessage("0", "参数paperId为空");
        }
        //校验必须 保留一条
        cm.ajax({
            url: 'services/portal/portaluser/pro/findTalentResumePaperVOListByResumeId',
            type: 'get',
            async: false,
            data: "",
            success: function (data) {
                if (data) {
                    if (data && data.length == 1) {
                        result = getMessage("0", "请至少保留一条发表论文信息!");
                    }
                }
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        //执行删除数据
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePaperVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增发明专利
     */
    hr.createPatent = function (formData) {
        var result = {};
        //必填校验
        if (!formData || !formData.patentName || !formData.patentNo || !formData.patentTimeStr || !formData.patentValue) {
            return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertResumePatentVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑发明专利
     */
    hr.updatePatent = function (formData,resumeId) {
      var result = {};
			for (var i = 0 ; i < formData.length; i++) {
				//必填校验
				if(!formData[i].patentName || !formData[i].patentNo || !formData[i].patentTimeStr || !formData[i].patentValue ){
					return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
				}
	    }
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePatentVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除发明专利
     */
    hr.deletePatent = function (formData) {
        var result = {};
        //判断主键id是否为空
        if (!formData.patentId) {
            return getMessage("0", "参数patentId为空");
        }
        /*//校验必须 保留一条
        cm.ajax({
            url : 'services/portal/portaluser/pro/findTalentResumePatentVOListByResumeId',
            type : 'get',
            async : false,
            data : "",
            success : function(data) {
                if(data){
                    if(data && data.length==1){
                        result = getMessage("0","请至少保留一条发明专利信息！");
                    }
                }
            },
            error: function(e){
                result =  getErrorMessage(e.message);
            }
        });*/
        //执行删除数据
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumePatentVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增参加学术会议
     */
    hr.createAcademic = function (formData) {
        var result = {};
        //必填校验
        if (!formData || !formData.meetingName || !formData.meetingResponsibility || !formData.meetingTimeStr) {
            return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertResumeMeetingVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑参加学术会议
     */
    hr.updateAcademic = function (formData,resumeId) {
        var result = {};
        for (var i = 0 ; i < formData.length; i++) {
			//必填校验
			if (!formData[i].meetingName || !formData[i].meetingResponsibility || !formData[i].meetingTimeStr) {
				return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
			}
		}
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumeMeetingVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除参加学术会议
     */
    hr.deleteAcademic = function (formData) {
        var result = {};
        //判断主键id是否为空
        if (!formData.meetingId) {
            return getMessage("0", "参数meetingId为空");
        }
        //执行删除数据
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateResumeMeetingVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }

    /**
     * 新增华为亲属
     */
    hr.createHuaWeiRelatives = function (formData) {
        var result = {};
        //必填校验
        if (!formData || !formData.contactEmployer
            || !formData.contactName || !formData.contactPhone
            || !formData.contactRelationship) {
            return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/insertTalentHuaweiContactVO/newHr',
            type: 'put',
            async: false,
            data: formData,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 编辑华为亲属
     */
    hr.updateHuaWeiRelatives = function (formData, resumeId) {
        var result = {};
        for (var i = 0 ; i < formData.length; i++) {
			//必填校验
			if (!formData[i].contactEmployer
				|| !formData[i].contactName || !formData[i].contactPhone
				|| !formData[i].contactRelationship) {
                return getErrorMessage($.i18nKeyp("Job.jobDetail.require"));
			}
        }
        var params = {}
        if(formData.length>0) {
          params = {items2Update: formData}
        }else{
          params = {items2Delete: [{resumeId:resumeId}]}
        }
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentHuaweiContactVO/newHr',
            type: 'put',
            async: false,
            data: params,
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    /**
     * 删除华为亲属
     */
    hr.deleteHuaWeiRelatives = function (formData) {
        var result = {};
        //判断主键id是否为空
        if (!formData.contactId) {
            return getMessage("0", "参数contactId为空");
        }
        //校验必须 保留一条
        // cm.ajax({
        //     url: 'services/portal/portaluser/pro/findTalentResumeHuaweiContactList',
        //     type: 'get',
        //     async: false,
        //     data: "",
        //     success: function (data) {
        //         if (data) {
        //             if (data && data.length == 1) {
        //                 result = getMessage("0", "请至少保留一条华为亲属信息！");
        //             }
        //         }
        //     },
        //     error: function (e) {
        //         result = getErrorMessage(e.message);
        //     }
        // });
        //执行删除数据
        var items2Delete = [];
        items2Delete.push(formData);
        cm.ajax({
            url: 'services/portal/portaluser/pro/updateTalentHuaweiContactVO/newHr',
            type: 'put',
            async: false,
            data: {items2Delete: items2Delete},
            success: function (data) {
                result = getMessage();
            },
            error: function (e) {
                result = getErrorMessage(e.message);
            }
        });
        return result;
    }
    // 查询招聘会日程
    hr.serachFairListInfo = function (param, callback) {
        //分页处理
        if (!param) {
            param = {};
        }
        param.curPage = param.curPage || 1;
        param.pageSize = param.pageSize || 10;
        var resultData = {};
        cm.ajax({
            url: 'services/portal/jobFairInfo/page/list/' + param.pageSize + '/' + param.curPage,
            type: 'POST',
            data: {"type": "2", "meetingEndTime": "1", "language": param.language || "language"},
            async: isFunction(callback),
            success: function (data) {
                if (!data || !data.length) {
                    resultData.status = '99';
                    resultData.data = {};
                } else {
                    resultData.status = '1';
                    resultData.data = data[0];
                }
                isFunction(callback) && callback(resultData);
            },
            error: function (e) {
                resultData = getErrorMessage(e.message);
                isFunction(callback) && callback(resultData);
            }
        });
        return resultData;
    };
	/**
	 * 删除简历
	 */
	hr.delResume = function(){
		var result = {};
		cm.ajax({
			async:false,
			url:"services/portal/portaluser/delResume/newHr/rec",
			type : 'POST',
			data:{},
			success : function(data){
				result = data;
			},
			error : function(data){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}

}(HW.Portal.Reccamp.Resume, HW.Portal.Reccamp.Common, window));

/**
 * HW.Portal.Reccamp.Job
 */
(function(jb, cm,win) {
	if (!jb) {
		console.log("HW.Portal.Reccamp.Job is null!");
		return;
	}

	/**
	 * 搜索职位列表
	 */
	jb.findJobList = function(formData,callback){
		if(!formData){
			return getMessage("0","搜索条件为空");
		}
		if(!formData.curPage || formData.curPage<=0){
			formData.curPage=1;
		}
		if(!formData.pageSize || formData.pageSize<=0){
			formData.pageSize=15;
		}
		if(formData.cityIds && formData.cityIds.length>0){
			formData.tempStr = 1;
		}
		if(formData.countryCodes && formData.countryCodes.length>0){
			formData.tempStr = 1;
		}
		if(formData.countryIdStr && formData.countryIdStr.length>0){
			formData.tempStr = 1;
		}
		formData.reqTime = new Date().getTime();
		if (formData.deptCodes) {
			formData.deptCode = formData.deptCodes;
			formData.deptCodes = null;
		}
		if (formData.jobType == "2") {
			formData.jobTypes = null;
		}
		/*if (formData.jobTypes == "2") {
			formData.jobTypes = "1";
		}*/
		//新增语言判断
		formData.language=headerinfo.curlanguage;
		formData.orderBy = "ISS_STARTDATE_DESC_AND_IS_HOT_JOB";
		if(formData.jobTypes && formData.jobType=='0' && formData.jobTypes=='3'){
			formData.graduateItem=formData.jobTypes;
			formData.jobTypes="";
		}
		var WesternEuropeList =["Belgium", "France", "Germany","Ireland","Italy","Netherlands","Portugal","Spain","Switzerland","United Kingdom"];
		var result = {};
		
		var tmpJobTypes = formData.jobTypes;
		var tmpCityCode = formData.cityCode;
		var tmpSearchText = formData.searchText;
		var tmpJobFamClsCode = formData.jobFamClsCode;
		
		cm.ajax({
			url : "services/portal/portalpub/getJob/newHr/page/"+formData.pageSize+"/"+formData.curPage,
			async : isFunction(callback),
			contentType: "application/json",
			data : formData,
			success : function(data) {
				if(data && data.result && data.result.length>0){
					var result = data.result;
					for(var i=0;i<result.length;i++){
						if(result[i] && result[i].jobAddress){
							var locName = result[i].jobAddress.split(";");
							locName = jb.arrDistinct(locName);
							result[i].jobAddress = locName.join(";");
							if(headerinfo.curlanguage !='zh_CN' && result[i].jobAddress=='全球'){
								result[i].jobAddress = 'Global';
								result[i].jobArea = 'Global';
							}
							//只有西欧城市时，增加西欧岗位标签
							for(var k=0;k<locName.length;k++){
								for(var j=0;j<WesternEuropeList.length;j++){
									if(locName[k].indexOf(WesternEuropeList[j]) > -1){
										flag=true;
										break;
									}
									else{
										flag=false;
									}
								}
								if(flag==false){
									break;
								}
							}
							if(flag==true){
								data.result[i].remark  ="WesternEurope";
							}
						}
						if (result[i].jobType == '2' && !result[i].studentAbroadPriority) {
							result[i].studentAbroadPriority = '4';
						}
					}
				}
				
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	jb.arrDistinct = function(locArr){
		var result = [];
		var i;
		var j;
		var len = locArr.length;
		for (i = 0; i < len; i++) {
			for (j = i+1; j < len; j++) {
				if (locArr[i] === locArr[j]) {
					j = ++i;
				}
			}
			result.push(locArr[i]);
		}
		return result;
	};

	/**
	 * 收藏职位（取消）
	 */
	jb.collectJob = function(formData){
		if(!formData.jobId || !formData.favFlag){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		// dataSource未传 赋值 -1 代表老系统，兼容开关关闭的情况（是否有开关开启，未传dataSource的情况？）
		if (!formData.dataSource) {
			formData.dataSource = '-1';
		}
		var result = {};
		cm.ajax({
			url : "services/portal/portaluser/collectJob/newHr?jobId="+ formData.jobId+"&favFlag="+formData.favFlag + "&dataSource=" + formData.dataSource,
			async : false,
			type : 'PUT',
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}
	/**
	 * 简历完整性校验
	 */
	jb.validResumeIntegrity = function(formData,callback){
		var result = getErrorMessage("No login!");
		if(!(window.headerinfo && headerinfo.user && headerinfo.user.userAccount)){
			return result;
		}
		if(!formData || !formData.validType){
			formData.validType = "jobApply";
		}
		var validResume = {success : '0', msg : "No login!", validFlag : ""};
		cm.ajax({
			async:isFunction(callback),
			type:"POST",
			url:"services/rec/baseTalent/pub/callNewHr",
			data:JSON.stringify({ "functionName":"resumeData_validResumeIntegrity","sys":"callNewCandidate","putResumeId":"1","recruitType":"rec", validType:formData.validType,userAccount:headerinfo.user.userAccount}),
			success : function(data){
				if(data && data.data){
					validResume.success = data.data.success;
					validResume.validFlag = data.data.validFlag;
					validResume.msg = data.data.msg;
				}
				if(validResume.success == '1') {
					if(validResume.validFlag == 1){
						result =  getErrorMessage(validResume.msg);
					}else if(validResume.msg && validResume.msg != "error：-1422"){
						result =  getErrorMessage(validResume.msg);
					}else{
						result = getSuccessMessage(validResume.msg);
					}
				} else {
					result =  getErrorMessage(validResume.msg);
				}
				isFunction(callback) && callback(result);
			},
			error : function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});

		return result;
	};
	/**
	 * 投递职位
	 */
	jb.appJob = function(formData){
		if(!formData.jobRequirementId || !formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		// 判断超2个投递记录则不允许再次投递
		var list = HW.Portal.Reccamp.Job.queryMyAppJobList({
            "graduateItem": "2",
            "classification": formData.classification
        });
		if(list.data.length >= 2){
			return getErrorMessage("校园招聘岗位最多只能投递两个，您可在个人中心-我的申请中调整所投递的岗位");
		}
		// job_pri自动获取
		if (list.data.length <= 0) {
			formData.pri = 1;
		} else if (list.data.length == 1 && list.data[0] && list.data[0].pri) {
			if (list.data[0].pri == 1) {
				formData.pri = 2;
			} else {
				formData.pri = 1;
			}
		}
		var result = {};
		formData.jobChannelId = '1';
		cm.ajax({
			url : "services/portal/portaluser/applyJob/newHr",
			async : false,
			type : 'POST',
			contentType: "application/json",
			data : formData,
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}
	/**
	 * 查询已收藏的数量
	 */
	jb.getMyCollectJobCount = function(formData,callback){
		var result = {};
		cm.ajax({
			url : 'services/portal/portaluser/getMyCollectJobCount?c=' + new Date().getTime(),
			async : isFunction(callback),
			type : 'get',
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查询已收藏的职位
	 */
	jb.getMyCollectJob = function(formData,callback){
		if(!formData || !formData.pageSize || !formData.curPage){
			formData = {};
			formData.pageSize = 8;
			formData.curPage = 1;
		}
		var result = {};
		cm.ajax({
			url : 'services/portal/portaluser/getMyCollectJob/newHr/page/' + formData.pageSize + '/' + formData.curPage + '?jobType='+formData.jobType+'&c=' + new Date().getTime(),
			async : isFunction(callback),
			type : 'get',
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 撤销投递职位
	 */
	jb.cancelJob = function(formData){
        if (formData && !formData.jobId) {
            formData.jobId = -1
        }
		if(!formData || !formData.resumeId || !formData.jobMailingId || !formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		if(formData.jobIntentId){
			formData.jobIntent = formData.jobIntentId;
			if(formData.jobIntentId.indexOf("JT")==0){
				formData.dataSource="1";
			}
		}
		var result = {};
		cm.ajax({
			url : "services/portal/portaluser/cancelJob/newHr",
			async : false,
			type : 'POST',
			contentType: "application/json",
			data : formData,
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}

	/**
	 * 查看广告失效时间
	 */
	jb.queryIssuanceStartDate = function(formData,callback){
		if(!formData || !formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		var dataResult = {};
		cm.ajax({
			url : "services/portal/portaluser/queryIssuanceStartDate/"+ formData.jobId,
			async : isFunction(callback),
			dataType : 'text',
			contentType: "application/json",
			success : function(data) {
				dataResult.issuanceEndDate = data;
				result = getSuccessMessage(dataResult);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 查看申请岗位列表（应聘进展里面的申请列表）
	 */
	jb.queryMyAppJob = function(formData,callback){
		if(!formData.curPage || formData.curPage<=0){
			formData.curPage=1;
		}
		if(!formData.pageSize || formData.pageSize<=0){
			formData.pageSize=5;
		}
		var result = {};
		cm.ajax({
			url: "services/portal/portaluser/queryMyAppJob/page/newHr/" + formData.pageSize + "/" + formData.curPage + "?classification=" + formData.classification,
			async : isFunction(callback),
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 查看岗位详情
	 */
	jb.getJobDetail = function(formData,callback){
		if(!formData || !formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url :"services/portal/portalpub/getJobDetail/newHr?jobId="+formData.jobId +'&dataSource='+formData.dataSource,
			async : isFunction(callback),
			contentType: "application/json",
			success : function(data) {
				if(headerinfo.curlanguage !='zh_CN' && data){
					if(data.jobArea=='全球'){
						data.jobArea = 'Global';
					}
					if(data.jobAddress=='全球'){
						data.jobAddress = 'Global';
					}
				}
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 查看岗位意向
	 */
	jb.findIntentList = function(formData,callback){
		if(!formData || !formData.jobRequirementId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url :"services/portal/portaluser/findIntentListByJobRequirementId/newHr/"+headerinfo.curlanguage+"/"+formData.jobRequirementId+"/"+formData.graduateItem,
			async : isFunction(callback),
			data : {"dataSource" : formData.dataSource,"jobId":formData.jobId},
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查看部门意向
	 */
	jb.findDeptByJobId = function(formData,callback){
		if(!formData || !formData.jobId || !formData.graduateItem){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url :'services/portal/portaluser/findDeptByJobId',
			type : 'GET',
			data : {"jobId":formData.jobId,"graduateItem":formData.graduateItem},
			async : isFunction(callback),
			contentType: "application/json",
			success : function(data) {
				if (data && data.length > 0) {
					for (var i = 0; i < data.length; i++) {
						//部门名称变更
						if(data[i].DEPTCODE == "047294"){
							data[i].FULLDEPTNAME ="047294/云与计算BG/Cloud & AI BG";
						}else if(data[i].DEPTCODE == "043779"){
							data[i].FULLDEPTNAME ="043779/Cloud & AI BG（Cloud BU）/Cloud & AI BG（Cloud BU）";
						}else if(data[i].DEPTCODE == "045969"){
							data[i].FULLDEPTNAME ="045969/Cloud & AI BG（计算产品线）/Cloud & AI BG(Computing Product Line)";
						}else if(data[i].DEPTCODE == "023093"){
							data[i].FULLDEPTNAME ="023093/集团IT（质量与流程IT部）/Group IT(Quality,Business Process & IT Dept)";
						}
					}
				}
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查看部门意向(一层部门)
	 */
	jb.findDeptAndfirstDeptByJobId = function(formData,callback){
		if(!formData || !formData.jobId || !formData.graduateItem){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var url = 'services/portal/portaluser/findDeptAndfirstDeptByJobId';
		var params = {"jobId":formData.jobId,"graduateItem":formData.graduateItem};
		if(formData.dataSource != '-1'){
			url = 'services/portal/portaluser/findDeptAndfirstDeptByJobIdNew';
			params = {"jobId":formData.jobId,"graduateItem":formData.graduateItem,"jobRequirementId":formData.jobRequirementId};
		}
		var result = {};
		cm.ajax({
			url :url,
			type : 'GET',
			data : params,
			async : isFunction(callback),
			contentType: "application/json",
			success : function(data) {
				if (data && data.length > 0) {
					for (var i = 0; i < data.length; i++) {
						//部门名称变更
					//	if(data[i].DEPTCODE == "047294"){
					//		data[i].FULLDEPTNAME ="047294/云与计算BG/Cloud & AI BG";
					//	}else if(data[i].DEPTCODE == "043779"){
					//		data[i].FULLDEPTNAME ="043779/Cloud & AI BG（Cloud BU）/Cloud & AI BG（Cloud BU）";
					//	}else if(data[i].DEPTCODE == "045969"){
					//		data[i].FULLDEPTNAME ="045969/Cloud & AI BG（计算产品线）/Cloud & AI BG(Computing Product Line)";
					//	}
                                                if(data[i].FIRSTLEVELDEPTCODE == "023093"){
							data[i].FIRSTLEVELDEPTNAME="023093/集团IT（质量与流程IT部）/Group IT(Quality,Business Process & IT Dept)";
						}
                                                if(data[i].DEPTCODE == "023093"){
							data[i].FULLDEPTNAME ="023093/集团IT（质量与流程IT部）/Group IT(Quality,Business Process & IT Dept)";
						}
					}
					var currentLanguage = headerinfo.curlanguage;
					data.sort(function(one, two) {
						var a1 = one["FIRSTDEPTALIAS"];
						try {
							if (!a1 && one["FIRSTLEVELDEPTNAME"]) {
								a1 = one["FIRSTLEVELDEPTNAME"].split("/")[currentLanguage == 'zh_CN' ? 1 : 2];
							}
							if (!a1) {
								a1 = one["DEPTALIAS"];
							}
							if (!a1 && one["FULLDEPTNAME"]) {
								a1 = one["FULLDEPTNAME"].split("/")[currentLanguage == 'zh_CN' ? 1 : 2];
							}
						} catch (e){}
						var b1 = two["FIRSTDEPTALIAS"];
						try {
							if (!b1 && two["FIRSTLEVELDEPTNAME"]) {
								b1 = two["FIRSTLEVELDEPTNAME"].split("/")[currentLanguage == 'zh_CN' ? 1 : 2];
							}
							if (!b1) {
								b1 = two["DEPTALIAS"];
							}
							if (!b1 && two["FULLDEPTNAME"]) {
								b1 = two["FULLDEPTNAME"].split("/")[currentLanguage == 'zh_CN' ? 1 : 2];
							}
						} catch (e){}
						a1 = a1 || "";
						b1 = b1 || "";
						// return a1.charCodeAt() - b1.charCodeAt();
						return a1.localeCompare(b1, 'zh-CN');
					});
				}
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查看岗位意向工作地
	 */
	jb.findLocByjobIdOrDeptCodes = function(formData,callback){
		if(!formData || !formData.jobId || !formData.graduateItem){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var deptCodes = formData.deptCodes?formData.deptCodes:"";
		var result = {};
		var url = 'services/portal/portaluser/findLocByjobIdOrDeptCodesNew/'+formData.jobRequirementId+'/'+headerinfo.curlanguage;
		cm.ajax({
			url :url,
			type : 'GET',
			data : {"object":(formData.jobId+"/"+deptCodes+"/"+formData.graduateItem)},
			async : isFunction(callback),
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查询申请岗位（申请岗位查询，只能投递2条）
	 */
	jb.queryMyAppJobList = function(formData,callback){
		formData = formData || {};
		formData.graduateItem = formData.graduateItem || '2';
		var result = {};
		cm.ajax({
			url :"services/portal/portaluser/queryMyAppJobList/newHr",
			async : false,
			contentType: "application/json",
			data:{
                graduateItem: formData.graduateItem,
                classification: formData.classification
            },
			success : function(data) {
				if (data && data.length < 2) {
					result = getSuccessMessage(data);
					isFunction(callback) && callback(result);
					return;
				}
				var orderData = [];
				var flag = false;
				$.each(data, function (ind, obj) {
					if (ind == 0 && obj.pri == 1) {
						flag = true;
						return;
					}
					orderData[0] = data[1];
					orderData[1] = data[0];
					return;
				})
				result = getSuccessMessage(flag ? data : orderData);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 查询岗位总数
	 */
	jb.getJobAllCount = function(){
		var result = {};
		cm.ajax({
			url :"services/portal/portalpub/getJobAllCount",
			async : false,
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}

	/**
	 * 岗位分享
	 */
	jb.saveShare = function(formData,callback){
		if(!formData || !formData.shareTitle || !formData.shareUrl || !formData.shareType || !formData.shareDesc || !formData.createdBy){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url :"services/rec/portal/conf/saveShare",
			async : isFunction(callback),
			type : 'POST',
			contentType : 'text/json',
			data:formData,
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 申请校招职位信息-进度
	 */
	jb.findMyjobProgress = function(param,callback){
		var result = {};
		cm.ajax({
			url:"services/portal/portaluser/queryMyJobInterviewPortal5/newHr?reqTime="+new Date().getTime(),
			async : isFunction(callback),
			type : 'get',
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);

				/**
				 * 过滤快照简历带来的重复应聘记录 - 开始
				 */
				 try {	
					if(result.data && result.data.length>1){
						let newData = [];
						let existsData = [];
						$.each(result.data, function(i, value){
							if(existsData.indexOf(value.INTERVIEWEE_ID)==-1){
							     existsData.push(value.INTERVIEWEE_ID);
							     newData.push(value);
							}
						});
						result.data = newData;
					}
				} catch (e){}
				/**
				 * 过滤快照简历带来的重复应聘记录 - 结束
				 */

				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 申请校招职位信息-面试考核进度
	 */
	jb.queryProcessSite = function(param,callback){
		var result = {};
		var url = "services/portal/portaluser/queryProcessSite/"+param.intervieweeId+"?reqTime="+new Date().getTime();
		if (param.dataSource == "1") {
			url = "services/portal/portaluser/queryProcessSiteNew/"+param.intervieweeId+"?reqTime="+new Date().getTime();
		}
		cm.ajax({
			url:url,
			async : isFunction(callback),
			type : 'get',
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

   /**
	 * 查询广告工作地
	 */
	jb.findStatAddress = function (formData,callback) {
        if(!formData){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
        var cm = HW.Portal.Reccamp.Common;
        formData.jobTypes = (formData.jobTypes || formData.jobTypes == 0)?formData.jobTypes : 'NO_DATA';
        formData.jobType = (formData.jobType || formData.jobType == 0)?formData.jobType : 'NO_DATA';
        var key = "RecFindStatAddress_" + formData.jobType + "_" + formData.jobTypes;
        cm.ajax({
            url:"services/portal/portalpub/findStatAddress/"+formData.jobType+"/"+formData.jobTypes,
            async : isFunction(callback),
            type : 'get',
            contentType: "application/json",
            success : function(data) {
                result = getSuccessMessage(data);
                isFunction(callback) && callback(result);
                cm.localStorageSetItem(key, result);
            },
            error : function(e) {
                result = getErrorMessage(e.message);
                isFunction(callback) && callback(result);
            }
        });
        return result;
	}

	/**
	 * 查询工作地
	 */
	jb.findStatCountryCity = function(formData,callback){
		if(!formData || !formData.type || !formData.jobFamClsCode){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		var cm = HW.Portal.Reccamp.Common;
		var key = "RecFindStatCountryCity_" + formData.jobFamClsCode + "_" + formData.jobFamClsCode + "_" + cm.getCurlanguage();
//		var value = cm.localStorageGetItem(key);
//		if (value) {
//			result = value;
//			isFunction(callback) && callback(result);
//			return result;
//		}
		cm.ajax({
			url:"services/portal/portalpub/findStatCountryCity/all/"+formData.type+"/"+formData.jobFamClsCode,
			async : isFunction(callback),
			type : 'get',
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
				cm.localStorageSetItem(key, result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 职位类别查询
	 */
	jb.findRecuimentType = function(param,callback){
		var result = {};
	/*	var cm = HW.Portal.Reccamp.Common;
		var key = "RecFindRecuimentType_"  + cm.getCurlanguage();
		var value = cm.localStorageGetItem(key);
		if (value) {
			result = value;
			isFunction(result) && callback(result);
			return result;
		}*/
		cm.ajax({
			url: "services/portal/portalpub/pub/list/lang/" + cm.getCurlanguage() + "/PORTAL_JOBFAM_CLASS",
			async : isFunction(callback),
			type : 'get',
			contentType: "application/json",
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}

	/**
	 * 设置第一志愿
	 */
	jb.priAppJob = function(param,callback){
		var result = {};
		var formData ={};
		formData.pri="2";
		formData.classification = param.classification !== "" && param.classification !== undefined ? param.classification : "";
		cm.ajax({
			url:"services/portal/portaluser/priAppJob/newHr",
			async : isFunction(callback),
			type : 'post',
			contentType: "application/json",
			data:formData,
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}


	/**
	 * 通过城市查找岗位数量
	 */
	jb.getSchoolJobListCount = function(formData,callback){
		//数据保存
		var result ={};
		cm.ajax({
			url : 'services/portal/portalpub/getSchoolJobListCount',
			type : 'post',
			data : formData,
			async : isFunction(callback),
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 岗位竞争度
	 */
	jb.getRecJobPopularity = function(formData,callback){
		if (!window.headerinfo || !headerinfo.user){
			return getErrorMessage();
		}
		if(!formData || !formData.externalJobForeignId || !formData.jobIntent){
			return getErrorMessage();
		}
		var result ={};
		/*
		cm.ajax({
			url : 'services/portal/portaluser/recJobPopularity/findRecJobPopularityList?reqtime='+ new Date().getTime(),
			type : 'GET',
			data : formData,
			async : isFunction(callback),
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		*/
		return result;
	}
	/**----------------------社招start------------------------------*/
	/**
	 * 社招--通过城市查找岗位数量
	 */
	jb.getSocialJobListCount = function(formData,callback){
		//数据保存
		var result ={};
		cm.ajax({
			url : '/socRecruitment/services/portal/portaluser/resumePerfect/getSocialJobListCount',
			type : 'post',
			data : formData,
			async : isFunction(callback),
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error : function(e) {
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 社招--搜索职位列表
	 */
	jb.findJobListSoc = function(formData,callback){
		if(!formData){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		if(!formData.curPage || formData.curPage<=0){
			formData.curPage=1;
		}
		if(!formData.pageSize || formData.pageSize<=0){
			formData.pageSize=15;
		}
		formData.orderBy = "P_COUNT_DESC";
		formData.jobType = "1";
		var result = {};
		cm.ajax({
			url : "/socRecruitment/services/portal3/portalnew/getJobList/page/"+formData.pageSize+"/"+formData.curPage,
			async : isFunction(callback),
			type : 'get',
			contentType: "application/json",
			data : formData,
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error:function(e){
				result = getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查询已收藏的数量
	 */
	jb.getMyCollectJobCountSoc = function(formData,callback){
		var result = {};
		cm.ajax({
			url : '/socRecruitment/services/portal/portaluser/getMyCollectJobCount?c=' + new Date().getTime(),
			async : isFunction(callback),
			type : 'get',
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 查询已收藏的职位
	 */
	jb.getMyCollectJobSoc = function(formData,callback){
		if(!formData || !formData.pageSize || !formData.curPage){
			formData = {};
			formData.pageSize = 8;
			formData.curPage = 1;
		}
		var result = {};
		cm.ajax({
			url : '/socRecruitment/services/portal/portaluser/getMyCollectJob/newHr/page/' + formData.pageSize + '/' + formData.curPage + '?c=' + new Date().getTime(),
			async : isFunction(callback),
			type : 'get',
			success : function(data) {
				result = getSuccessMessage(data);
				isFunction(callback) && callback(result);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
				isFunction(callback) && callback(result);
			}
		});
		return result;
	}
	/**
	 * 岗位收藏列取消操作
	 */
	jb.cancelCollect = function(formData){
		if(!formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url:"/reccampportal/services/portal/portaluser/cancelCollectJob/newHr",
			async : false,
			type : 'post',
			contentType: "application/json",
			data: formData,
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}

	/**
	 * 岗位收藏列取消操作-社招
	 */
	jb.cancelCollectSoc = function(formData){
		if(!formData.jobId){
			return getErrorMessage("参数不合法,请检查后再试");
		}
		var result = {};
		cm.ajax({
			url:"/socRecruitment/services/portal/portaluser/deleteCollectJob/newHr",
			async : false,
			type : 'post',
			contentType: "application/json",
			data: formData,
			success : function(data) {
				result = getSuccessMessage(data);
			},
			error: function(e){
				result =  getErrorMessage(e.message);
			}
		});
		return result;
	}
	/**----------------------社招end------------------------------*/
}(HW.Portal.Reccamp.Job, HW.Portal.Reccamp.Common, window));

/**
 * 封装返回信息
 * status 状态码
 * msg提示消息
 * data返回数据
 */
function getMessage(status,msg,data){
	var result ={};
	result.status = status?status:"1";
	result.msg = msg;
	result.data = data;
	return result;
}

/**
 * 封装返回成功信息
 * data返回数据
 */
function getSuccessMessage(data){
	var result ={};
	result.status = "1";
	result.msg = "";
	result.data = data;
	return result;
}
/**
 * 封装返回失败信息
 * data返回数据
 */
function getErrorMessage(msg){
	var result ={};
	result.status = "0";
	result.msg = msg;
	return result;
}
/**
 * 封装返回空信息
 * data返回数据
 */
function getEmptyMessage(){
	var result ={};
	result.status = "99";
	result.msg = "未获取到数据!";
	return result;
}
$.i18nCache = {

	"portal.unknown.error.message": {
		"en_US": '非常抱歉，系统处理您的请求时发生了未知错误，请稍后再试！',
		"zh_CN": 'System error. Please try again later.'
	},
	"portal.getCountry.error.message": {
		"en_US": '获取国家数据失败',
		"zh_CN": '获取国家数据失败'
	},
	"job.appCampJob.notice4":
		{
			"zh_CN": '校园招聘职位最多只能投递两个',
			"en_US": 'You can apply for a maximum of two graduate recruitment positions. '
		},
	"job.appsucess":
		{
			"zh_CN": '职位申请成功',
			"en_US": 'Job applied successfully.'
		},
	"portal.items.require":
		{
			"zh_CN": "请填写必填项",
			"en_US": "Please fill in the mandatory items"
		},
	"portal.idcard.duplicated": {
		"zh_CN": '该身份证号已经存在，不能再次注册。请发邮件至 talent@huawei.com，我们会在收到邮件后与您联系解决！',
		"en_US": 'The ID number already exists and cannot be registered again. Please send email to talent@huawei.com, we will contact you after receiving the message!'
	},
	"portal.certificate.duplicated": {
		"zh_CN": '该证件号已经存在，不能再次注册。请发邮件至 talent@huawei.com，我们会在收到邮件后与您联系解决！',
		"en_US": 'The certificate number already exists and cannot be registered again. Please send email to talent@huawei.com, we will contact you after receiving the message!'
	},
	"portal.email.duplicated": {
		"zh_CN": '该邮箱已经存在，不能再次注册。请发邮件至 talent@huawei.com，我们会在收到邮件后与您联系解决！',
		"en_US": 'The email already exists and cannot be registered again. Please send email to talent@huawei.com, we will contact you after receiving the message!'
	},
	"portal.phone.duplicated": {
		"zh_CN": '该电话已经存在，不能再次注册。请发邮件至 talent@huawei.com，我们会在收到邮件后与您联系解决！',
		"en_US": 'The phone number already exists and cannot be registered again. Please send email to talent@huawei.com, we will contact you after receiving the message!'
	},
	"portal.resumeManager.validBirthDate":
		{
			"zh_CN": '出生日期填写异常，请核对后重新录入',
			"en_US": 'Date of birth in abnormal, Please check the entered again.'
		},
	"portal.recruitmentProgress.daishaixuan":
		{
			"zh_CN": "待筛选",
			"en_US": "To be screened"
		},
	"portal.recruitmentProgress.shaixuantongguo":
		{
			"zh_CN": "筛选通过",
			"en_US": "Screening Passed"
		},
	"portal.recruitmentProgress.wanchengpaixu":
		{
			"zh_CN": "面试已完成，录用排序中",
			"en_US": "Interview completed. Waiting for hiring approval"
		},
	"portal.recruitmentProgress.mianshiwancheng":
		{
			"zh_CN": "面试已完成",
			"en_US": "Interview Completed"
		},
	"portal.recruitmentProgress.yixiangshuqueren":
		{
			"zh_CN": "录用意向书确认",
			"en_US": "Confirm the employment letter of intent"
		},
	"portal.recruitmentProgress.yiqianyue":
		{
			"zh_CN": "已签约",
			"en_US": "Already Signed"
		},
	"portal.recruitmentProgress.yiqueren":
		{
			"zh_CN": "已确认意向书",
			"en_US": "Confirmed the letter of intent"
		},
	"portal.recruitmentProgress.weiyue":
		{
			"zh_CN": "违约",
			"en_US": "Breach of contract"
		},
	"portal.recruitmentProgress.yiruzhi":
		{
			"zh_CN": "已入职",
			"en_US": "Onboarding Confirmed"
		},
	"portal.recruitmentProgress.shaixuanbutongguo":
		{
			"zh_CN": "筛选不通过",
			"en_US": "Screening failed"
		},
	"portal.recruitmentProgress.mianshibutongguo":
		{
			"zh_CN": "面试未通过",
			"en_US": "Interview failed"
		},
	"portal.recruitmentProgress.yijieshu":
		{
			"zh_CN": "已结束",
			"en_US": "Ended"
		},
	"portal.recruitmentProgress.luyongbutongguo":
		{
			"zh_CN": "录用审批不通过",
			"en_US": "Hiring approval failed"
		},
	"portal.recruitmentProgress.luyongqianyue":
		{
			"zh_CN": "录用签约",
			"en_US": "Hiring Subscription"
		},
	"portal.recruitmentProgress.jujueoffer":
		{
			"zh_CN": "已拒绝offer",
			"en_US": "Refused the offer"
		},
	"portal.recruitmentProgress.jujueyixiangshu":
		{
			"zh_CN": "已拒绝意向书",
			"en_US": "Refused the intent"
		},
	"portal.recruitmentProgress.yixiangweiyue":
		{
			"zh_CN": "意向违约",
			"en_US": "Broken contract"
		},
	"portal.recruitmentProgress.fangqiruzhi":
		{
			"zh_CN": "放弃入职",
			"en_US": "Given up registration"
		},
	"portal.recruitmentProgress.yizhuangang":
		{
			"zh_CN": "已转岗",
			"en_US": "Transferred"
		},
	"portal.recruitmentProgress.chaoqishifang":
		{
			"zh_CN": "超期释放",
			"en_US": "Overdue release"
		},
	"portal.recruitmentProgress.ruzhibaodao":
		{
			"zh_CN": "入职报到",
			"en_US": "Enrollment Progress"
		},
	"portal.recruitmentProgress.offerqueren":
		{
			"zh_CN": "offer确认",
			"en_US": "Confirm the offer"
		},
	"portal.recruitmentProgress.jieshouoffer":
		{
			"zh_CN": "已接受offer",
			"en_US": "Offer Accepted"
		},
	"portal.recruitmentProgress.pass":{
		"en_US": 'Passed',
		"zh_CN": "通过"
	},
	"portal.recruitmentProgress.reject":{
		"en_US": 'Failed',
		"zh_CN": "不通过"
	},
	"portal.recruitmentProgress.transfer":{
		"en_US": 'Transfer',
		"zh_CN": "转岗"
	},
	"portal.recruitmentProgress.complete":{
		"en_US": 'Completed',
		"zh_CN": "已完成"
	},
	"portal.recruitmentProgress.notcomplete":{
		"en_US": 'Not completed',
		"zh_CN": "未完成"
	},
	"Job.jobDetail.require":
		{
			"zh_CN": "请填写必填项",
			"en_US": "Please fill in the mandatory items"
		}
};