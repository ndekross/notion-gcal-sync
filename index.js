require("dotenv").config({
  path: "./.env",
})
const fs = require("fs")
const readline = require("readline")
const { Client } = require("@notionhq/client")
const { google } = require("googleapis")
const { clearInterval, setInterval } = require("timers")

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
})

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/calendar"]
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json"

// Load client secrets from a local file.

function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  )

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback)
    oAuth2Client.setCredentials(JSON.parse(token))
    callback(oAuth2Client)
  })
}

function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  })
  console.log("Authorize this app by visiting this url:", authUrl)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  rl.question("Enter the code from that page here: ", code => {
    rl.close()
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err)
      oAuth2Client.setCredentials(token)
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
        if (err) return console.error(err)
        console.log("Token stored to", TOKEN_PATH)
      })
      callback(oAuth2Client)
    })
  })
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function createEvents(auth, events) {
  let APIQueue = [...events]
  console.log(`Syncing ${events.length} events`)

  const calendar = google.calendar({ version: "v3", auth })

  let intervalId = setInterval(() => {
    calendar.events.insert(
      {
        auth,
        calendarId: "primary",
        resource: APIQueue.shift(),
      },
      (error, event) => {
        let status = `${APIQueue.length + 1}/${events.length}`
        if (error) {
          if (
            error.code === 409 &&
            error.message === "The requested identifier already exists."
          ) {
            status += " (skipped)"
            console.log(status)
          } else console.log(JSON.stringify(error, null, 2))
          //TODO Implement logging to Notion
        }
      }
    )

    if (APIQueue.length === 0) {
      clearInterval(intervalId)
    }
  }, 1000)
}

;(async () => {
  const myTasks = await notion.databases.query({
    database_id: process.env.TASK_DATABASE_ID,
    filter: {
      property: "Schedule",
      date: {
        is_not_empty: true,
        on_or_after: new Date().toISOString(),
      },
    },
  })

  //TODO sync events with Google Calendar
  const events = myTasks.results.map(result => {
    const date = result.properties.Schedule.date
    let start, end

    start = end = {
      timeZone: "America/New_York",
    }

    if (date.start.length > 10) {
      start.dateTime = date.start
      end.dateTime = date.end ? date.end : date.start
    } else {
      start.date = date.start
      end.date = date.end ? date.end : date.start
    }

    return {
      id: result.id.split("-").join(""),
      summary: result.properties.Name.title[0].plain_text,
      start,
      end,
    }
  })

  fs.readFile("credentials.json", (err, content) => {
    if (err) return console.log("Error loading client secret file:", err)
    // Authorize a client with credentials, then call the Google Calendar API.
    authorize(JSON.parse(content), auth => createEvents(auth, events))
  })
})()
