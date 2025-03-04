import { models } from '../models'
import { Op } from 'sequelize'
import { indexBy } from 'underscore'
import { sendNotification, resetNotifyTribeCount } from '../hub'
import * as socket from '../utils/socket'
import * as jsonUtils from '../utils/json'
import * as helpers from '../helpers'
import { failure, success } from '../utils/res'
import * as timers from '../utils/timers'
import { sendConfirmation } from './confirmations'
import * as network from '../network'
import * as short from 'short-uuid'
import constants from '../constants'
import { logging, sphinxLogger } from '../utils/logger'

// deprecated
export const getMessages = async (req, res) => {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id

  const dateToReturn = req.query.date

  if (!dateToReturn) {
    return getAllMessages(req, res)
  }

  sphinxLogger.info(dateToReturn, logging.Express)

  const owner = req.owner
  // const chatId = req.query.chat_id

  const newMessagesWhere = {
    date: { [Op.gte]: dateToReturn },
    [Op.or]: [{ receiver: owner.id }, { receiver: null }],
    tenant,
  }

  const confirmedMessagesWhere = {
    updated_at: { [Op.gte]: dateToReturn },
    status: {
      [Op.or]: [constants.statuses.received],
    },
    sender: owner.id,
    tenant,
  }

  const deletedMessagesWhere = {
    updated_at: { [Op.gte]: dateToReturn },
    status: {
      [Op.or]: [constants.statuses.deleted],
    },
    tenant,
  }

  // if (chatId) {
  // 	newMessagesWhere.chat_id = chatId
  // 	confirmedMessagesWhere.chat_id = chatId
  // }

  const newMessages = await models.Message.findAll({ where: newMessagesWhere })
  const confirmedMessages = await models.Message.findAll({
    where: confirmedMessagesWhere,
  })
  const deletedMessages = await models.Message.findAll({
    where: deletedMessagesWhere,
  })

  const chatIds: number[] = []
  newMessages.forEach((m) => {
    if (!chatIds.includes(m.chatId)) chatIds.push(m.chatId)
  })
  confirmedMessages.forEach((m) => {
    if (!chatIds.includes(m.chatId)) chatIds.push(m.chatId)
  })
  deletedMessages.forEach((m) => {
    if (!chatIds.includes(m.chatId)) chatIds.push(m.chatId)
  })

  const chats =
    chatIds.length > 0
      ? await models.Chat.findAll({
          where: { deleted: false, id: chatIds, tenant },
        })
      : []
  const chatsById = indexBy(chats, 'id')

  res.json({
    success: true,
    response: {
      new_messages: newMessages.map((message) =>
        jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
      ),
      confirmed_messages: confirmedMessages.map((message) =>
        jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
      ),
      deleted_messages: deletedMessages.map((message) =>
        jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
      ),
    },
  })
  res.status(200)
  res.end()
}

export const getAllMessages = async (req, res) => {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id

  const limit = (req.query.limit && parseInt(req.query.limit)) || 1000
  const offset = (req.query.offset && parseInt(req.query.offset)) || 0
  let order = 'asc'
  if (req.query.order && req.query.order === 'desc') {
    order = 'desc'
  }

  sphinxLogger.info(
    `=> getAllMessages, limit: ${limit}, offset: ${offset}`,
    logging.Express
  )

  const clause: { [k: string]: any } = {
    order: [['id', order]],
    where: { tenant },
  }
  const all_messages_length = await models.Message.count(clause)
  if (limit) {
    clause.limit = limit
    clause.offset = offset
  }
  const messages = await models.Message.findAll(clause)

  sphinxLogger.info(
    `=> got msgs, ${messages && messages.length}`,
    logging.Express
  )

  const chatIds: number[] = []
  messages.forEach((m) => {
    if (m.chatId && !chatIds.includes(m.chatId)) {
      chatIds.push(m.chatId)
    }
  })

  const chats =
    chatIds.length > 0
      ? await models.Chat.findAll({
          where: { deleted: false, id: chatIds, tenant },
        })
      : []
  // console.log("=> found all chats", chats && chats.length);
  const chatsById = indexBy(chats, 'id')
  // console.log("=> indexed chats");
  success(res, {
    new_messages: messages.map((message) =>
      jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
    ),
    new_messages_total: all_messages_length,
    confirmed_messages: [],
  })
}

export const getMsgs = async (req, res) => {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id

  const limit = req.query.limit && parseInt(req.query.limit)
  const offset = req.query.offset && parseInt(req.query.offset)
  const dateToReturn = req.query.date
  if (!dateToReturn) {
    return getAllMessages(req, res)
  }

  sphinxLogger.info(
    `=> getMsgs, limit: ${limit}, offset: ${offset}`,
    logging.Express
  )

  let order = 'asc'
  if (req.query.order && req.query.order === 'desc') {
    order = 'desc'
  }
  const clause: { [k: string]: any } = {
    order: [['id', order]],
    where: {
      updated_at: { [Op.gte]: dateToReturn },
      tenant,
    },
  }
  const numberOfNewMessages = await models.Message.count(clause)
  if (limit) {
    clause.limit = limit
    clause.offset = offset
  }
  const messages = await models.Message.findAll(clause)
  sphinxLogger.info(
    `=> got msgs, ${messages && messages.length}`,
    logging.Express
  )
  const chatIds: number[] = []
  messages.forEach((m) => {
    if (m.chatId && !chatIds.includes(m.chatId)) {
      chatIds.push(m.chatId)
    }
  })

  const chats =
    chatIds.length > 0
      ? await models.Chat.findAll({
          where: { deleted: false, id: chatIds, tenant },
        })
      : []
  const chatsById = indexBy(chats, 'id')
  success(res, {
    new_messages: messages.map((message) =>
      jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])
    ),
    new_messages_total: numberOfNewMessages,
  })
}

export async function deleteMessage(req, res) {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id

  const id = parseInt(req.params.id)

  const message = await models.Message.findOne({ where: { id, tenant } })
  const uuid = message.uuid
  await message.update({ status: constants.statuses.deleted })

  const chat_id = message.chatId
  let chat
  if (chat_id) {
    chat = await models.Chat.findOne({ where: { id: chat_id, tenant } })
  }
  success(res, jsonUtils.messageToJson(message, chat))

  if (!chat) {
    return failure(res, 'no Chat')
  }
  const isTribe = chat.type === constants.chat_types.tribe

  const owner = req.owner
  const isTribeOwner = isTribe && owner.publicKey === chat.ownerPubkey

  if (isTribeOwner) {
    timers.removeTimerByMsgId(id)
  }
  network.sendMessage({
    chat: chat,
    sender: owner,
    type: constants.message_types.delete,
    message: { id, uuid },
  })
}

export const sendMessage = async (req, res) => {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id
  // try {
  // 	schemas.message.validateSync(req.body)
  // } catch(e) {
  // 	return failure(res, e.message)
  // }
  const {
    contact_id,
    text,
    remote_text,
    chat_id,
    remote_text_map,
    amount,
    reply_uuid,
    boost,
    message_price,
  } = req.body

  let msgtype = constants.message_types.message
  if (boost) msgtype = constants.message_types.boost

  const date = new Date()
  date.setMilliseconds(0)

  const owner = req.owner
  const chat = await helpers.findOrCreateChat({
    chat_id,
    owner_id: owner.id,
    recipient_id: contact_id,
  })
  if (!chat) return failure(res, 'counldnt findOrCreateChat')

  let realSatsContactId
  // IF BOOST NEED TO SEND ACTUAL SATS TO OG POSTER
  if (!chat) {
    return failure(res, 'no Chat')
  }
  const isTribe = chat.type === constants.chat_types.tribe
  const isTribeOwner = isTribe && owner.publicKey === chat.ownerPubkey
  if (reply_uuid && boost && amount) {
    const ogMsg = await models.Message.findOne({
      where: {
        uuid: reply_uuid,
        tenant,
      },
    })
    if (ogMsg && ogMsg.sender) {
      realSatsContactId = ogMsg.sender
    }
  }

  const hasRealAmount = amount && amount > constants.min_sat_amount

  const remoteMessageContent = remote_text_map
    ? JSON.stringify(remote_text_map)
    : remote_text
  const uuid = short.generate()
  let amtToStore = amount || 0
  if (
    boost &&
    message_price &&
    typeof message_price === 'number' &&
    amount &&
    message_price < amount
  ) {
    amtToStore = amount - message_price
  }
  const msg: { [k: string]: any } = {
    chatId: chat.id,
    uuid: uuid,
    type: msgtype,
    sender: owner.id,
    amount: amtToStore,
    date: date,
    messageContent: text,
    remoteMessageContent,
    status: constants.statuses.pending,
    createdAt: date,
    updatedAt: date,
    network_type:
      !isTribe || hasRealAmount || realSatsContactId
        ? constants.network_types.lightning
        : constants.network_types.mqtt,
    tenant,
  }
  if (reply_uuid) msg.replyUuid = reply_uuid
  // console.log(msg)
  const message = await models.Message.create(msg)

  success(res, jsonUtils.messageToJson(message, chat))

  const msgToSend: { [k: string]: any } = {
    id: message.id,
    uuid: message.uuid,
    content: remote_text_map || remote_text || text,
    amount: amtToStore,
  }
  if (reply_uuid) msgToSend.replyUuid = reply_uuid

  const sendMessageParams: { [k: string]: any } = {
    chat: chat,
    sender: owner,
    amount: amount || 0,
    type: msgtype,
    message: msgToSend,
  }
  if (realSatsContactId) sendMessageParams.realSatsContactId = realSatsContactId
  // tribe owner deducts the "price per message + escrow amount"
  if (realSatsContactId && isTribeOwner && amtToStore) {
    sendMessageParams.amount = amtToStore
  }
  // final send
  // console.log('==> FINAL SEND MSG PARAMS', sendMessageParams)
  network.sendMessage(sendMessageParams)
}

export const receiveMessage = async (payload) => {
  sphinxLogger.info(`received message ${payload}`)

  const {
    owner,
    sender,
    chat,
    content,
    remote_content,
    msg_id,
    chat_type,
    sender_alias,
    msg_uuid,
    date_string,
    reply_uuid,
    amount,
    network_type,
    sender_photo_url,
    message_status,
  } = await helpers.parseReceiveParams(payload)
  if (!owner || !sender || !chat) {
    return sphinxLogger.info('=> no group chat!')
  }
  const tenant: number = owner.id
  const text = content || ''

  let date = new Date()
  date.setMilliseconds(0)
  if (date_string) date = new Date(date_string)

  const msg: { [k: string]: any } = {
    chatId: chat.id,
    uuid: msg_uuid,
    type: constants.message_types.message,
    sender: sender.id,
    date: date,
    amount: amount || 0,
    messageContent: text,
    createdAt: date,
    updatedAt: date,
    status: message_status || constants.statuses.received,
    network_type: network_type,
    tenant,
  }
  const isTribe = chat_type === constants.chat_types.tribe
  if (isTribe) {
    msg.senderAlias = sender_alias
    msg.senderPic = sender_photo_url
    if (remote_content) msg.remoteMessageContent = remote_content
  }
  if (reply_uuid) msg.replyUuid = reply_uuid
  const message = await models.Message.create(msg)

  socket.sendJson(
    {
      type: 'message',
      response: jsonUtils.messageToJson(message, chat, sender),
    },
    tenant
  )

  sendNotification(chat, msg.senderAlias || sender.alias, 'message', owner)

  sendConfirmation({ chat, sender: owner, msg_id, receiver: sender })
}

export const receiveBoost = async (payload) => {
  const {
    owner,
    sender,
    chat,
    content,
    remote_content,
    chat_type,
    sender_alias,
    msg_uuid,
    date_string,
    reply_uuid,
    amount,
    network_type,
    sender_photo_url,
    msg_id,
  } = await helpers.parseReceiveParams(payload)

  sphinxLogger.info(
    `=> received boost  ${amount} sats on network: ${network_type}`,
    logging.Network
  )
  if (!owner || !sender || !chat) {
    return sphinxLogger.error('=> no group chat!')
  }
  const tenant: number = owner.id
  const text = content

  let date = new Date()
  date.setMilliseconds(0)
  if (date_string) date = new Date(date_string)

  const msg: { [k: string]: any } = {
    chatId: chat.id,
    uuid: msg_uuid,
    type: constants.message_types.boost,
    sender: sender.id,
    date: date,
    amount: amount || 0,
    messageContent: text,
    createdAt: date,
    updatedAt: date,
    status: constants.statuses.received,
    network_type,
    tenant,
  }
  const isTribe = chat_type === constants.chat_types.tribe
  if (isTribe) {
    msg.senderAlias = sender_alias
    msg.senderPic = sender_photo_url
    if (remote_content) msg.remoteMessageContent = remote_content
  }
  if (reply_uuid) msg.replyUuid = reply_uuid
  const message = await models.Message.create(msg)

  socket.sendJson(
    {
      type: 'boost',
      response: jsonUtils.messageToJson(message, chat, sender),
    },
    tenant
  )

  sendConfirmation({ chat, sender: owner, msg_id, receiver: sender })

  if (msg.replyUuid) {
    const ogMsg = await models.Message.findOne({
      where: { uuid: msg.replyUuid, tenant },
    })
    if (ogMsg && ogMsg.sender === tenant) {
      sendNotification(chat, msg.senderAlias || sender.alias, 'boost', owner)
    }
  }
}

export const receiveRepayment = async (payload) => {
  const { owner, sender, chat, date_string, amount, network_type } =
    await helpers.parseReceiveParams(payload)

  sphinxLogger.info(`=> received repayment ${amount}sats`, logging.Network)
  if (!owner || !sender || !chat) {
    return sphinxLogger.error('=> no group chat!')
  }
  const tenant = owner.id

  let date = new Date()
  date.setMilliseconds(0)
  if (date_string) date = new Date(date_string)

  const message = await models.Message.create({
    // chatId: chat.id,
    type: constants.message_types.repayment,
    sender: sender.id,
    date: date,
    amount: amount || 0,
    createdAt: date,
    updatedAt: date,
    status: constants.statuses.received,
    network_type,
    tenant,
  })

  socket.sendJson(
    {
      type: 'repayment',
      response: jsonUtils.messageToJson(message, null, sender),
    },
    tenant
  )
}

export const receiveDeleteMessage = async (payload) => {
  sphinxLogger.info('=> received delete message', logging.Network)
  const { owner, sender, chat, chat_type, msg_uuid } =
    await helpers.parseReceiveParams(payload)
  if (!owner || !sender || !chat) {
    return sphinxLogger.error('=> no group chat!')
  }
  const tenant = owner.id

  const isTribe = chat_type === constants.chat_types.tribe
  // in tribe this is already validated on admin's node
  const where: { [k: string]: any } = { uuid: msg_uuid, tenant }
  if (!isTribe) {
    where.sender = sender.id // validate sender
  }
  const message = await models.Message.findOne({ where })
  if (!message) return

  await message.update({ status: constants.statuses.deleted })
  socket.sendJson(
    {
      type: 'delete',
      response: jsonUtils.messageToJson(message, chat, sender),
    },
    tenant
  )
}

export const readMessages = async (req, res) => {
  if (!req.owner) return failure(res, 'no owner')

  const chat_id = req.params.chat_id
  const owner = req.owner
  const tenant: number = owner.id

  await models.Message.update(
    { seen: true },
    {
      where: {
        sender: {
          [Op.ne]: owner.id,
        },
        chatId: chat_id,
        [Op.or]: [{ seen: false }, { seen: null }],
        tenant,
      },
    }
  )
  const chat = await models.Chat.findOne({ where: { id: chat_id, tenant } })
  if (chat) {
    resetNotifyTribeCount(parseInt(chat_id))
    await chat.update({ seen: true })
    success(res, {})
    sendNotification(chat, '', 'badge', owner)
    socket.sendJson(
      {
        type: 'chat_seen',
        response: jsonUtils.chatToJson(chat),
      },
      tenant
    )
  } else {
    failure(res, 'no chat')
  }
}

export const clearMessages = (req, res) => {
  if (!req.owner) return failure(res, 'no owner')
  const tenant: number = req.owner.id

  models.Message.destroy({ where: { tenant }, truncate: true })

  success(res, {})
}
