
import { tokenFromTerms } from './ldat'
import * as path from 'path'
import * as rsa from '../crypto/rsa'
const constants = require(path.join(__dirname,'../../config/constants.json'))

function addInRemoteText(full:{[k:string]:any}, contactId, isTribe:boolean){
	const m = full && full.message
	if (!(m && m.content)) return full
	if (!(typeof m.content==='object')) return full
	if(isTribe) {
		// if just one, send it (for tribe remote_text_map... is there a better way?)
		if(Object.values(m.content).length===1) {
			return fillmsg(full, {content: Object.values(m.content)[0]})
		}
	}
	return fillmsg(full, {content: m.content[contactId+'']})
}

function removeRecipientFromChatMembers(full:{[k:string]:any}, destkey){
	const c = full && full.chat
	if (!(c && c.members)) return full
	if (!(typeof c.members==='object')) return full

    const members = {...c.members}
	if(members[destkey]) delete members[destkey]
	return fillchatmsg(full, {members})
}

function removeAllNonAdminMembersIfTribe(full:{[k:string]:any}, destkey){
	return full
	// const c = full && full.chat
	// if (!(c && c.members)) return full
	// if (!(typeof c.members==='object')) return full

    // const members = {...c.members}
	// if(members[destkey]) delete members[destkey]
	// return fillchatmsg(full, {members})
}

// THIS IS ONLY FOR TRIBE OWNER
// by this time the content and mediaKey are already in message as string
async function encryptTribeBroadcast(full:{[k:string]:any}, contact, isTribe:boolean, isTribeOwner:boolean){
	if(!isTribeOwner) return full

	const chat = full && full.chat
	const message = full && full.message
	if (!message || !(chat && chat.type && chat.uuid)) return full
	const obj: {[k:string]:any} = {}
	if(isTribe && isTribeOwner) { // has been previously decrypted
		if(message.content) {
			const encContent = await rsa.encrypt(contact.contactKey, message.content)
			obj.content = encContent
		}
		if(message.mediaKey) {
			const encMediaKey = await rsa.encrypt(contact.contactKey, message.mediaKey)
			obj.mediaKey = encMediaKey
		}
	}
	return fillmsg(full, obj)
}

function addInMediaKey(full:{[k:string]:any}, contactId){
	const m = full && full.message
	if (!(m && m.mediaKey)) return full
	if (!(m && m.mediaTerms)) return full
	if (!(typeof m.mediaKey==='object')) return full
	
	const mediaKey = m.mediaTerms.skipSigning ? '' : m.mediaKey[contactId+'']
	return fillmsg(full, {mediaKey})
}

// add the token if its free, but if a price just the base64(host).muid
async function finishTermsAndReceipt(full:{[k:string]:any}, destkey) {
	const m = full && full.message
	if (!(m && m.mediaTerms)) return full

	const t = m.mediaTerms
	const meta = t.meta || {}
	t.ttl = t.ttl || 31536000
	meta.ttl = t.ttl
	const mediaToken = await tokenFromTerms({
		host: t.host || '',
		muid: t.muid,
		ttl: t.skipSigning ? 0 : t.ttl,
		pubkey: t.skipSigning ? '' : destkey,
		meta
	})
	const fullmsg = fillmsg(full, {mediaToken})
	delete fullmsg.message.mediaTerms
	return fullmsg
}

// DECRYPT EITHER STRING OR FIRST VAL IN OBJ
async function decryptMessage(full:{[k:string]:any}, chat) {
	if(!chat.groupPrivateKey) return full
	const m = full && full.message
	if (!m) return full

	const obj: {[k:string]:any} = {}
	if(m.content) {
		console.log('m.content:',m.content, typeof m.content)
		let content = m.content
		if(typeof m.content==='object') {
			if(Object.values(m.content).length) {
				content = Object.values(m.content)[0]
			}
		}
		console.log("CONTENT TO DECRYPT:",content)
		const decContent = rsa.decrypt(chat.groupPrivateKey, content)
		obj.content = decContent
	}
	if (m.mediaKey) {
		let mediaKey = m.mediaKey
		if(typeof m.mediaKey==='object') {
			if(Object.values(m.mediaKey).length) {
				mediaKey = Object.values(m.mediaKey)[0]
			}
		}
		const decMediaKey = rsa.decrypt(chat.groupPrivateKey, mediaKey)
		obj.mediaKey = decMediaKey
	}

	console.log("OBJ FILLED",fillmsg(full, obj))
	return fillmsg(full, obj)
}

async function personalizeMessage(m,contact,isTribeOwner:boolean){
	const contactId = contact.contactId
	const destkey = contact.publicKey
	
	const cloned = JSON.parse(JSON.stringify(m))
	console.log('cloned',cloned)

	const chat = cloned && cloned.chat
	const isTribe = chat.type&&chat.type===constants.chat_types.tribe

	const msgWithRemoteTxt = addInRemoteText(cloned, contactId, isTribe)
	console.log('msgWithRemoteTxt',msgWithRemoteTxt)
	const cleanMsg = removeRecipientFromChatMembers(msgWithRemoteTxt, destkey)
	const cleanerMsg = removeAllNonAdminMembersIfTribe(cleanMsg, destkey)
	const msgWithMediaKey = addInMediaKey(cleanerMsg, contactId)
	const msgWithMediaToken = await finishTermsAndReceipt(msgWithMediaKey, destkey)
	const encMsg = await encryptTribeBroadcast(msgWithMediaToken, contact, isTribe, isTribeOwner)
	console.log('encMsg',encMsg)
    return encMsg
}

function fillmsg(full, props){
	return {
		...full, message: {
			...full.message,
			...props,
		}
	}
}

function fillchatmsg(full, props){
	return {
		...full, chat: {
			...full.chat,
			...props,
		}
	}
}

export {
    personalizeMessage, decryptMessage,
}