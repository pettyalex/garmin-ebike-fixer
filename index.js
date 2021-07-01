addEventListener('fetch', (event) => {
  event.respondWith(
    handleRequest(event.request).catch(
      (err) => new Response(err.stack, { status: 500 }),
    ),
  )
})

// environment variables
const clientId = STRAVA_CLIENT_ID
const clientSecret = STRAVA_CLIENT_SECRET
const REDIRECT_URI = "https://garmin-ebike-fixer.catjunior.workers.dev/oauth_redirect"
// const accessToken = STRAVA_ACCESS_TOKEN // Short lived, pulled from the web UI. Only has basic read scope

function handleNotFound() {
  return new Response(null, {
    status: 404,
  })
}

/**
 * Handles /login
 *
 * Gives user a link to click on to start the oauth login process
 */
function handleLogin() {
  const stravaOauthLink = new URL(`https://www.strava.com/oauth/authorize`)
  
  stravaOauthLink.searchParams.set("client_id", STRAVA_CLIENT_ID)
  stravaOauthLink.searchParams.set("redirect_uri", REDIRECT_URI)
  stravaOauthLink.searchParams.set("response_type", "code")
  stravaOauthLink.searchParams.set("scope", "activity:read_all,activity:write")

  const html = `<a href="${stravaOauthLink.toString()}">CLICK HERE</a>`

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8"
    }
  })
}

/**
 * Handles /oauth_redirect
 *
 * The redirect will have code and scope params in the querystring for success
 * or an error param for an error
 */
async function handleOauthRedirect(request) {
  const url = new URL(request.url)
  const urlParams = url.searchParams

  const authorizationCode = urlParams.get('code')
  const scope = urlParams.get('scope')

  // Make a POST request to https://www.strava.com/api/v3/oauth/token
  /**
   * 
   * 
client_id
required integer, in query	The application’s ID, obtained during registration.
client_secret
required string, in query	The application’s secret, obtained during registration.
code
required string, in query	The code parameter obtained in the redirect.
grant_type
required string, in query	The grant type for the request. For initial authentication, must always be "authorization_code".

   */
  const authParams = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    code: authorizationCode,
    grant_type: "authorization_code"
  })
  const tokenObject = await getAccessTokenAndSaveIntoCache(authParams)

  // Return a response that it worked
  return new Response("Hey, we got your access token and saved it into Key / Value storage, it looks ilke this " + JSON.stringify(tokenObject))
}

/**
 * /strava/webhook
 *
 * @param {Request} request
 * @returns {Response}
 */
async function handleStravaUpdateWebhook(request) {
  // Get activity ID from webhook request
  const {
    aspect_type,
    event_time,
    object_id,
    object_type,
    owner_id,
    subscription_id,
  } = await request.json()

  // Get access token by athlete id
  const accessToken = await getAccessTokenForAthlete(owner_id)

  // Get whole activity
  const activityBody = await fetch(
    `https://www.strava.com/api/v3/activities/${object_id}?include_all_efforts=false`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  const activityContents = await activityBody.json()

  // Check if the activity is uploaded from the watch and is a weekday morning


  // Update activity to set type ebike, commute, and set bicycle to the radwagon

  // For testing
  return new Response(JSON.stringify(activityContents), {
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * /strava/athlete
 * 
 * Can't leave this one open, it will be vulnerable to breaking strava API limits
 * 
 * @param {Request} request 
 */
async function handleStravaAthleteRequest(request) {
  const athleteId = new URL(request.url).searchParams.get("athleteId")
  const accessToken = await getAccessTokenForAthlete(athleteId)

  const athleteResponse = await fetch("https://www.strava.com/api/v3/athlete", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  // const athlete = await athleteResponse.json()

  return athleteResponse
}

/**
 * Obtains a working access token for a given athlete, either by accessing a valid, non-expired token from
 * K/V storage, or by using the refresh token to obtain a new token and store it
 *
 * @param {string} athleteId
 */
async function getAccessTokenForAthlete(athleteId) {
  // Lookup payload from K/V store
  const {
    expires_at,
    access_token,
    refresh_token
  } = JSON.parse(await STRAVA_OAUTH.get(`athletes/${athleteId}`))
  // Check if it will expire soon, return token if valid
  const soon = Math.floor(Date.now() / 1000) + 60 // Next minute
  if (expires_at > soon) {
    return access_token
  }

  // Renew it and re-store token if expired
  const authParams = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    client_secret: STRAVA_CLIENT_SECRET,
    refresh_token: refresh_token,
    grant_type: "refresh_token"
  })

  const tokenInfo = await getAccessTokenAndSaveIntoCache(authParams, athleteId)

  return tokenInfo.access_token
}

/**
 * Makes a request to get an access token and refresh token, and saves it into cache for the future.
 * Returns back the token information
 * 
 * @param {URLSearchParams} authParams 
 * @param {string | null} athleteId 
 * @returns { expires_at, access_token, refresh_token }
 */
async function getAccessTokenAndSaveIntoCache(authParams, athleteId) {
  const stravaOauthResponse = await fetch("https://www.strava.com/api/v3/oauth/token", {
    method: "POST",
    body: authParams
  })
  /**
   * {
  "token_type": "Bearer",
  "expires_at": 1568775134,
  "expires_in": 21600,
  "refresh_token": "e5n567567...",
  "access_token": "a4b945687g...",
  "athlete": { // Only exists for initial call, not on refresh_token
    #{summary athlete representation}
  }
}
   */
  const { expires_at, access_token, refresh_token, athlete } = await stravaOauthResponse.json()

  if (!athleteId) {
    athleteId = athlete.id
  }
  
  const tokenObject = {
    expires_at,
    access_token,
    refresh_token
  }

  await STRAVA_OAUTH.put(`athletes/${athleteId}`, JSON.stringify(tokenObject))

  return tokenObject
}

/**
 * Respond with hello worker text
 * @param {Request} request
 */
async function handleRequest(request) {
  const { pathname } = new URL(request.url)
  const trimmedPath = pathname.replace(/\/+$/, '')

  // Route to various handlers
  switch (trimmedPath) {
    case '/login':
      return handleLogin()
    case '/oauth_redirect':
      return await handleOauthRedirect(request)
    case '/strava/webhook':
      return await handleStravaUpdateWebhook(request)
    case '/strava/athlete':
      return await handleStravaAthleteRequest(request)
    default:
      return handleNotFound()
  }
}

/**
 * Extracts the properties from a strava webhook request
 * @param {Object} body
 */
function extractWebhookBody(body) {
  // Example Request
  // {
  //     "aspect_type": "update",
  //     "event_time": 1516126040,
  //     "object_id": 1360128428,
  //     "object_type": "activity",
  //     "owner_id": 134815,
  //     "subscription_id": 120475,
  //     "updates": {
  //         "title": "Messy"
  //     }
  // }
}
