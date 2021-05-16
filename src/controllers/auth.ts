import {createJWT, scopes} from "../utils/jwt";
import { success, failure } from "../utils/res";
import * as tribes from "../utils/tribes";

interface MeInfo {
  photoUrl: string
  alias: string
  routeHint: string
  contactKey: string
  jwt: string
}

export async function verifyAuthRequest(req, res) {
  if (!req.owner) return failure(res, "no owner");
  const j = req.body
  if(!j.host || !j.challenge) return failure(res, 'nope1')
  try {
    const sc = [scopes.PERSONAL]
    const jot = createJWT(req.owner.publicKey, sc)
    const bod:MeInfo = {
      alias: req.owner.alias,
      photoUrl: req.owner.photoUrl,
      routeHint: req.owner.routeHint,
      contactKey: req.owner.contactKey,
      jwt: jot,
    }
    const token = await tribes.genSignedTimestamp(req.owner.publicKey)
    const protocol = j.host.includes("localhost") ? "http" : "https";
    await fetch(`${protocol}://${j.host}/verify/${j.challenge}?token=${token}`, {
      method: "POST",
      body: JSON.stringify(bod),
      headers: {
        "Content-Type": "application/json",
      },
    });
    success(res, 'ok')
  } catch(e) {
    failure(res, e)
  }
}

export async function requestExternalTokens(req, res) {
  if (!req.owner) return failure(res, "no owner");
  try {
    const result:MeInfo = {
      alias: req.owner.alias,
      photoUrl: req.owner.photoUrl,
      routeHint: req.owner.routeHint,
      contactKey: req.owner.contactKey,
      jwt: ''
    }
    success(res, result)
  } catch (e) {
    failure(res, e);
  }
}
