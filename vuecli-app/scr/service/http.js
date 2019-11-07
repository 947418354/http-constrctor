/**
 * @see 浏览器和微信端的http请求
 *  对接网关2.0
 */

import axios from 'axios'
import CONSTANTS from '@/constants'
import Utils from '@/utils'
import { Toast } from 'vant'
import messageQueue from '@/service/MessageQueue.js'

const API_BASE = process.env.VUE_APP_IS_MOCK === 'true' ? 'http://127.0.0.1:3003/mock' : CONSTANTS.API_BASE
const IS_GREY_DEPLOY = process.env.VUE_APP_IS_GREY === 'true'
const WEB_VERSION = process.env.VUE_APP_DEPLOY_WEB_VERSION
// 状态常量
const LOGIN_SIGN = {
  DEFAULT: 0, // 不要求登录态
  NEED_LOGIN: 1, // 要求传递登录态，不强制要求登录
  MUST_LOGIN: 2, // 必须登录
}

// 控制是否 toast 接口返回 
const RESPONSE_NEED_TOAST = true



// 设置默认请求超时时间
axios.defaults.timeout = 15000

let pending = [] // 声明一个数组用于存储每个ajax请求的取消函数和ajax标识
const judgeRepeatRequest = (config, isRemove) => {
  // 不需要节流的接口
  if (!config || !config.needThrottle) {
    return false
  }
  let id = JSON.stringify(config, ['url', 'method'])
  for (let p in pending) {
    if (pending[p].id === id) {
      if (isRemove) {
        pending.splice(p, 1) // 把这条记录从数组中移除
      }
      return true
    }
  }
  return false
}

// 请求拦截器
axios.interceptors.request.use(function (config) {
  if (config.aload) {
    Toast.loading({
      duration: 0, // 持续展示 toast
      forbidClick: true, // 禁用背景点击
      loadingType: 'spinner'
    })
  }

  if (IS_GREY_DEPLOY) {
    config.headers.webversion = WEB_VERSION
  }
  // 在一个ajax发送前存入requestList列表
  const isRepeatedRequest = judgeRepeatRequest(config)
  if (isRepeatedRequest) {
    throw new Error('重复的请求')
  } else {
    // 这里的ajax标识我是用请求地址&请求方式拼接的字符串，当然你可以选择其他的一些方式
    config.needThrottle && pending.push({
      id: JSON.stringify(config, ['url', 'method'])
    })
  }

  // 扩展一个字段, loginSign
  if (!Utils.UA.isHczApp && config.loginSign) {
    // APP 外 secret_token headers
    config.headers = Object.assign(config.headers || {}, {
      secret_token: Utils.CACHE.getStorage('noncestr') || Utils.URL.getParam('noncestr') || ''
    })
  }


  if(config.fromData) {
    //设置axios为form-data
    config.headers = Object.assign(config.headers || {},{'Content-Type': 'application/x-www-form-urlencoded'})
      let ret = ''
      for (let it in config.data) {
        ret += encodeURIComponent(it) + '=' + encodeURIComponent(config.data[it]) + '&'
      }
      config.data = ret
  }

  return config
}, function (error) {
  return Promise.reject(error)
})

// 添加响应拦截器
axios.interceptors.response.use(response => {
  Toast.clear()
  judgeRepeatRequest(response.config, true) // 在一个ajax响应后再执行一下取消操作，把已经完成的请求从pending中移除
  // 网关返回登录态失效
  if (response.status === 200 && response.data && response.data.code === 201 && !Utils.UA.isHczApp) {
    // APP 外传递登出消息
    messageQueue.trigger('logout')
    if (response.config.loginSign === LOGIN_SIGN.MUST_LOGIN) {
      messageQueue.trigger('login')
    }
  }
  // 控制接口错误返回提示
  if (response.status === 200 && response.data && response.data.code === 101 && response.config.needToast === RESPONSE_NEED_TOAST) {
    Toast(response.data.msg)
  }
  return response.data
}, error => {
  Toast.clear()
  error.config && judgeRepeatRequest(error.config, true)
  error.response && judgeRepeatRequest(error.response.config, true)
  // APP 内网关报 480 的登录处理
  if (error && error.response && error.response.config.loginSign === LOGIN_SIGN.MUST_LOGIN && (error.response.status === 480 || error.response.status === 481) && error.response.data.status === 7 ) {
    if (Utils.UA.isHczApp) {
      messageQueue.trigger('login')
    }
  }
  return Promise.reject(error)
})

/**
 * @param {Object} config 请求配置
 * @param {Boolean} loginSign 是否需要登录
 */
const getData = (config, loginSign, needThrottle) => {

  if (config.url.indexOf('http') !== 0) {
    config.url = API_BASE + config.url
  }

  return axios({
    method: config.method || 'get',
    url: config.url,
    data: config.data,
    params: config.params || {},
    responseType: 'json',
    headers: config.headers || {},
    aload: config.aload || false,
    loginSign: loginSign,
    needThrottle: needThrottle,
    needToast: config.needToast || false, // 是否在接口报错时显示Toast
    fromData: config.fromData || false,
  })
}

export default getData
