"use strict";

// --------------------------------- 80chars ---------------------------------->
var express = require('express')
var https = require('https')
var http = require('http')
var bodyParser = require('body-parser')
var session = require('express-session')
var Sequelize = require('sequelize')

// Setting session store to Sequelize
var SequelizeStore = require('connect-session-sequelize')(session.Store)

// Initializing the app
var app = express()

// Enabling cookies via HTTPS
app.set('trust proxy', 1)
app.set('view engine', 'ejs');

// Enabling JSON request parser
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))

// Initiating global model classes 
var User = null
var UserGoal = null

// Importing integration settings
var settings = require('./settings')

// Setting up a new database using database credentials set in .env
var sequelize = new Sequelize('database', process.env.DB_USER, 
                                          process.env.DB_PASS, {
  host: '0.0.0.0',
  dialect: 'sqlite',
  pool: {
    max: 5,
    min: 0,
    idle: 10000,
  },
  // Security note: the database is saved to the file `database.sqlite` in 
  // the local filesystem. It's deliberately placed in the `.data` directory
  // which doesn't get copied if someone remixes the project.
  storage: '.data/database.sqlite',
})

// Setting up session parameters
app.use(session({
  secret: 'beeminder is great',
  store: new SequelizeStore({ db: sequelize }),
  saveUninitialized: false,
  resave: false,
  cookie: { secure: true },
  trustProxie: true,
}))

// Connecting to the database and defining Models
sequelize.authenticate()
  .then((err) => {
    console.log('Database connection established.')
    User = sequelize.define('users', {           // Defining table 'users'
      username:     { type: Sequelize.STRING },
      access_token: { type: Sequelize.STRING },
    })
    UserGoal = sequelize.define('usergoals', {   // Defining table 'usergoals'
      user_id:      { type: Sequelize.INTEGER },
      goal:         { type: Sequelize.STRING },
      linktype:     { type: Sequelize.STRING },
      params:       { type: Sequelize.STRING },
      last_updated: { type: Sequelize.DATE },
      score:        { type: Sequelize.STRING },
    })
    sequelize.sync()              // Creating table User if it does not exist
  })
  .catch((err) => {
    console.log('Unable to connect to the database: ', err)
  })

// Defining path to static files
app.use(express.static('pub'))

// Setting up listener
var listener = app.listen(process.env.PORT, () => {
  console.log('app is listening on port ' + listener.address().port)
})

app.get("/", (request, response) => {
  response.render('index.ejs', {
    BEEMINDER_CLIENT_ID: process.env.BEEMINDER_CLIENT_ID, 
    AUTH_REDIRECT_URI:   process.env.AUTH_REDIRECT_URI,
    CONNECTIONS: settings.connections,
    APP_NAME: process.env.APP_NAME,
    DEFAULT_CONNECTION: process.env.DEFAULT_CONNECTION_NAME
  })
})

// Callback endpoint to receive username and access_token from Beeminder upon 
// successful authorization
app.get("/connect", (request, response) => {
  if(typeof request.query.access_token === 'undefined' || 
     typeof request.query.username === 'undefined') {
    request.session.access_token = null
    request.session.username = null
    if(typeof request.query.error != 'undefined') {
      request.session.error = request.query.error
      request.session.error_description = request.query.error_description
    }
  } else {
    request.session.access_token = request.query.access_token
    request.session.username = request.query.username
  }
  response.redirect('/')
})

// JSON endpoint to check for successful user authorization and retrieve current
// links in the database
app.get("/get-links", (request, response) => {

  // Check if there is an error from Beeminder in the session storage
  if(typeof request.session.error != 'undefined') {
    var error = { error: request.session.error, 
                  error_description: request.session.error_description}
    delete request.session.error
    delete request.session.error_description
    response.status(500).send(JSON.stringify(error))
  } else {
  
    // Only users redirected from Beeminder or users w/ correct sessions allowed
    if ((typeof request.session.username == 'undefined' || 
         typeof request.session.access_token == 'undefined') && 
         typeof request.session.userId == 'undefined')
      response.sendStatus(404)

    // Checking whether it's a new login
    if (typeof request.session.username != 'undefined' && 
        typeof request.session.access_token != 'undefined' &&
        request.session.username != null &&
        request.session.access_token != null) {
      var username = request.session.username
      var access_token = request.session.access_token
      var newLogin = true
      delete request.session.username
      delete request.session.access_token
      getBeeminderGoals({username: username, access_token: access_token}, (beeminderGoals) => {
        if (typeof beeminderGoals == 'undefined'){
          response.setHeader('Content-Type', 'application/json')
          response.send(JSON.stringify({ goals: null, 
                                         error: 'Authentication error' }))
        } else {
          User.findOrCreate({where: {username:username}}).spread((user) => {
            User.update({access_token: access_token}, {where: {id:user.id}})
            request.session.userId = user.id
            syncAndReturnGoalsList(user, beeminderGoals, (goals) => { 
              response.send(JSON.stringify({ goals: goals, 
                                             connections: settings.connections, 
                                             beeGoals: beeminderGoals})) })
          }, (err) => { 
            console.log(err)
            response.send(JSON.stringify({ error: err })) })
        }
      }, (err) => { console.log(err)
                    response.send(JSON.stringify({ error: err })) })

    // Here go all previously logged in users
    } else {
      User.findOne({where: {id:request.session.userId}})
        .then( (user) => {
          var username = user.username
          var access_token = user.access_token
          getBeeminderGoals({username: username, access_token: access_token}, (beeminderGoals) => {
            if (typeof beeminderGoals == 'undefined'){
              response.setHeader('Content-Type', 'application/json')
              response.send(JSON.stringify({ goals: null, 
                                             error: 'Authentication error' }))
            } else {
              syncAndReturnGoalsList(user, beeminderGoals, (goals) => { 
                response.send(JSON.stringify({ goals: goals, 
                                               connections: settings.connections,
                                               beeGoals: beeminderGoals })) })
            }
          }, (err) => { console.log(err)
                        response.send(JSON.stringify({ error: err })) })
        }).catch((error) => {
          response.status(404)
        })
    }
  }
})

// Endpoint for deleting link
app.get("/delete-link", (request, response) => {
  if (typeof request.session.userId == 'undefined') {
    response.status(404)
  } else {
    var id = request.query.id
    UserGoal.destroy({where: {user_id:request.session.userId, id: id}}).then( 
      (data) => {
        response.sendStatus(200)
      }, (err) => { console.log(err); response.status(404).render('error404') })
  }
})

// Endpoint for setting up new connections
app.post("/setup-link", (request, response) => {
  
  console.log('DEBUG: ' + request.session.userId)
  // Only for logged in users
  if (typeof request.session.userId === 'undefined') {
    response.sendStatus(404)
  } else {
    var incomingData = request.body

    // Initial submission must include at least link type, goal name, parameters
    if (incomingData.linktype && 
        (incomingData.newConnection.goal || incomingData.creatingBeeminderGoal) &&
        incomingData.newConnection.params) {
      if (incomingData.linktype && 
          typeof settings.connections[incomingData.linktype] == 'undefined') {
        response.status(401).send('Incorrect parameters provided [1]')
      } else {
        User.findOne({where:{id:request.session.userId}}).then( (user) => {
          var access_token = user.access_token
          var username = user.username
          var linktype = incomingData.linktype
          var goal = incomingData.newConnection.goal
          var params = incomingData.newConnection.params
          var start_value = incomingData.newConnection.startValue || 0
          var creatingBeeminderGoal = incomingData.creatingBeeminderGoal || false
          var newBeeGoal = incomingData.newBeeGoal

          // Fetching up-to-date set of goals from Beeminder
          getBeeminderGoals(user, (goals) => {
            if (goals.indexOf(goal) > -1 && !creatingBeeminderGoal) {
              
              // Fetching current value of the goal from Beeminder
              getBeeminderGoalValue(user, goal, (curval, goal_type) => {
                if(start_value < curval) { start_value = curval }
                
                // Fetching current value from the source
                getSourceValue({ linktype: linktype,
                                 params: JSON.stringify(params)}, (score) => {
                  if (goal && linktype && typeof start_value != 'undefined' && 
                      typeof score != 'undefined' && 
                      incomingData.action == 'Save') {
                    // If it's a "save" action, updating Beeminder goal value
                    var score = score ? score : 0
                    updateBeeminderGoal({ goal:goal, linktype: linktype, 
                                          params: JSON.stringify(params), 
                                          start_value: start_value, 
                                          score:score }, 
                                        goal_type,
                                        user, 
                                        () => { 
                                          setupAutofetch(user, goal, 
                                                         (status= true, 
                                                          err_msg= null) => {
                                            if (status) {
                                              console.log(status)
                                              response.sendStatus(200)
                                            } else {
                                              response.status(500).send(err_msg)
                                            }
                                          })
                                        })
                  } else {
                    // Sending data back to the user
                    var score = score || 0
                    response.send(JSON.stringify({ beeGoals: goals,
                                                   newConnection: { 
                                                     params: params,
                                                     goal: goal,
                                                     startValue: start_value, 
                                                     score: score }}))
                  }
                }, (err) => {
                  // There is an error fetching data from the source
                  response.send(JSON.stringify({ beeGoals: goals,
                                                 newConnection: { 
                                                   params: params,
                                                   goal: goal,
                                                   startValue: start_value, 
                                                   score: null }, 
                                                 sourceError: err }))
                })
              }, (err) => {
                // There is an error fetching data from Beeminder
                response.send(JSON.stringify({ beeGoals: goals,
                                               newConnection: { 
                                                 params: params, 
                                                 goal: goal,
                                                 startValue: start_value, 
                                                 score: null }, 
                                               targetError: err }))
              })
            } else if (creatingBeeminderGoal && goals.indexOf(newBeeGoal.slug) == -1){
              // We are creating new Beeminder goal

              // Fetching current value from the source
              getSourceValue({ linktype: linktype,
                               params: JSON.stringify(params)}, (score) => {
                if (linktype && typeof score != 'undefined' && 
                    newBeeGoal.slug != 'undefined' && newBeeGoal.rate != 'undefined' && newBeeGoal.goalval != 'undefined' &&
                    incomingData.action == 'Save') {
                  // If it's a "save" action, create Beeminder goal with initial value
                  var score = score ? score : 0
                  newBeeGoal.score = score
                  createBeeminderGoal( newBeeGoal, 
                                      { linktype: linktype, 
                                        params: JSON.stringify(params),
                                        start_value: score,
                                        score: score
                                      }, 
                                      user, 
                                      () => { 
                                        setupAutofetch(user, newBeeGoal.slug, 
                                                       (status= true, 
                                                        err_msg= null) => {
                                          if (status) {
                                            console.log(status)
                                            response.sendStatus(200)
                                          } else {
                                            response.status(500).send(err_msg)
                                          }
                                        })
                                      },
                                      (err_msg) => {
                                        response.status(500).send(err_msg)
                                      }
                                     )
                } else {
                  // Sending data back to the user
                  var score = score || 0
                  response.send(JSON.stringify({ beeGoals: goals,
                                                 newConnection: { 
                                                   params: params,
                                                   goal: goal,
                                                   startValue: start_value, 
                                                   score: score }}))
                }
              }, (err) => {
                // There is an error fetching data from the source
                response.send(JSON.stringify({ beeGoals: goals,
                                               newConnection: { 
                                                 params: params,
                                                 goal: goal,
                                                 startValue: start_value, 
                                                 score: null }, 
                                               sourceError: err }))
              })
              
              
            } else if (creatingBeeminderGoal && goals.indexOf(newBeeGoal.slug) > -1){
              // The submitted goal name already exists in Beeminder and we are trying to create it
              response.send(JSON.stringify({ beeGoals: goals,
                                             newConnection: {
                                               params: params,
                                               goal: goal,
                                               startValue: start_value, 
                                               score: null }, 
                                             targetError: 'This goal is already present in Beeminder. Try cancelling goal creation and select goals from dropdown list instead'}))
            } else {
              // The submitted goal name does not exist in Beeminder
              response.send(JSON.stringify({ beeGoals: goals,
                                             newConnection: {
                                               params: params,
                                               goal: goal,
                                               startValue: start_value, 
                                               score: null }, 
                                             targetError: 'Unknown goal'}))
            }
          }, () => { response.send(JSON.stringify({ beeGoals: null })) })
        }, () => { response.redirect('/') })
      }
    } else {
      response.status(401).send('Incorrect parameters provided [2]')
    }
  }
})

app.get("/logout", (request, response) => {
  request.session.userId = null
  response.redirect('/')
})

app.post("/autofetch", (request, response) => {
  console.log('Starting Autofetch')
    User.findOne({where: {username:request.body.username}}).then( (user) => {
      UserGoal.findOne({where:{user_id:user.id, 
                               goal: request.body.slug}}).then( (usergoal) => {
        if(usergoal != null){
          getBeeminderGoalValue(user, usergoal.goal, (curval, goal_type) => {
            getSourceValue(usergoal, (sourceval) => {
              if (curval < sourceval) {
                updateBeeminderGoal({ goal:     usergoal.goal, 
                                      linktype: usergoal.linktype, 
                                      params:   usergoal.params, 
                                      start_value: curval, score: sourceval },
                                    goal_type,
                                    user)
              } else {
                console.log(
                  `DEBUG: curval (${curval}) >= sourceval (${sourceval})`)
              }
            })
          })
        }
      })
    })
  response.sendStatus(200)
})


// Helper functions

function updateBeeminderGoal(data, goal_type, user, callback = ()=>{}, error_callback = ()=>{}) {
  UserGoal.findOrCreate({where: { user_id: user.id, goal: data.goal }})
    .spread((usergoal, created) => {
      if (created) {
        UserGoal.update(data, { where: {id: usergoal.id} })
      }
      
      var options = {
        host: 'www.beeminder.com',
        port: 443,
        path: '/api/v1/users/' + user.username + '/goals/' + data.goal 
              + '/datapoints.json?access_token=' + user.access_token 
              + '&value=' + (goal_type == 'biker' ? data.score*1 : ( data.score*1 - data.start_value*1 )),
        method: 'POST',
        body: '',
      }
      var req = https.request(options, (res) => {
        var data = ''
        res.on('data', (chunk) => {
          data = data + chunk
        }).on('end', () => {
          data = JSON.parse(data)
          UserGoal.update({ score: data.score, last_updated: Date.now() },
                          { where: {id:usergoal.id}}).then(callback())
        })
      })
      req.on('error', (e) => {
        console.log('problem with request: ' + e.message)
        UserGoal.destroy({where: {user_id:user.id, id: usergoal.id}}).then(error_callback('Unable to update goal data in Beeminder. ' + e.message))
      })
      req.write('')
      req.end()
    })
}

function createBeeminderGoal(newBeeGoal, goalData, user, callback = ()=>{}, error_callback = ()=>{}) {
  var options = {
    host: 'www.beeminder.com',
    port: 443,
    path: '/api/v1/users/' + user.username + '/goals.json'
          + '?access_token=' + user.access_token 
          + '&slug=' + encodeURIComponent(newBeeGoal.slug) + '&rate=' + newBeeGoal.rate*1
          + '&goalval=' + newBeeGoal.goalval*1 + '&initval=' + goalData.score*1
          + '&goal_type=biker' + (newBeeGoal.runits ? '&runits=' + newBeeGoal.runits : ''),
    method: 'POST',
    body: '',
  }
  console.log(options)
  var req = https.request(options, (res) => {
    var data = ''
    res.on('data', (chunk) => {
      data = data + chunk
    }).on('end', () => {
      data = JSON.parse(data)
      console.log(data)
      if (typeof data.errors != 'undefined' ) {
        error_callback('You provide incorrect parameters: '+JSON.stringify(data.errors))
      } else {
        UserGoal.findOrCreate({where: { user_id: user.id, goal: newBeeGoal.slug }})
          .spread((usergoal, created) => {
            goalData.last_updated = Date.now()
            UserGoal.update(goalData, { where: {id: usergoal.id} }).then(callback())
          })
      }
    })      
  })
  req.on('error', (e) => {
    console.log('problem with request: ' + e.message)
    error_callback('Unable to create the goal in Beeminder. ' + e.message)
  })
  req.write('')
  req.end()

}

function setupAutofetch(user, goal, callback = ()=>{}) {
  var options = {
    host: 'www.beeminder.com',
    port: 443,
    path: '/api/v1/users/' + user.username + '/goals/' + goal 
          + '.json?access_token=' + user.access_token 
          + '&datasource=' + process.env.APP_NAME,
    method: 'PUT',
    body: '',
  }
  var req = https.request(options, (res) => {
    var data = ''
    res.on('data', (chunk) => {
      data = data + chunk
    }).on('end', () => {
      console.log(data)
      callback()
    })
  })
  req.on('error', (e) => {
    console.log(e)
    console.log('problem with request: ' + e.message)
    callback(false, e.message)
  })
  req.write('')
  req.end()
}


function getBeeminderGoals(user, callback, error_callback = ()=>{}) {
  var options = {
    host: 'www.beeminder.com',
    port: 443,
    path: '/api/v1/users/' + user.username + '/goals.json?access_token=' + user.access_token,
    method: 'GET',
  }
  var req = https.request(options, (res) => {
    var data = ''
    res.on('data', (chunk) => {
      data = data + chunk
    }).on('end', () => {
      var goals = JSON.parse(data)
      if(goals.length > 0) {
        var goalsList = []
        goals.forEach((goal)=>{ 
          if(goal.goal_type=='biker' || goal.goal_type=='hustler') goalsList.push(goal.slug)
        })
        callback(goalsList)
      } else {
        error_callback()
      }
    })
  })
  req.on('error', (e) => {
    console.log('problem with request: ' + e.message)
    error_callback(e.message)
  })
  req.write('')
  req.end()
}

function syncAndReturnGoalsList(user, beeminderGoals, callback) {
  UserGoal.findAll({where:{user_id : user.id}}).then( (usergoals) => {
    var result = []
    console.log(usergoals.length)
    usergoals.forEach( (usergoal) => {
      if (beeminderGoals.indexOf(usergoal.goal) == -1) {
        UserGoal.destroy({where:{id: usergoal.id}})
      } else {
        result.push(usergoal)
      }
    })
    callback(result)
  })
}

function getBeeminderGoalValue(user, goal, callback, error_callback = ()=>{}) {
  var options = {
    host: 'www.beeminder.com',
    port: 443,
    path: '/api/v1/users/' + user.username + '/goals/' + goal 
          + '.json?access_token=' + user.access_token,
    method: 'GET',
  }

  var req = https.request(options, (res) => {
    var data = ''
    res.on('data', (chunk) => {
      data = data + chunk
    }).on('end', () => {
      var body = JSON.parse(data)
      if(typeof body.curval != 'undefined') {
          callback(body.curval, body.goal_type)
      } else {
        error_callback('Current value not received from Beeminder')
      }
    })
  })
  req.on('error', (e) => {
    console.log('problem with request: ' + e.message)
    error_callback(e.message)
  })
  req.write('')
  req.end()
}

function getSourceValue(goal, callback, error_callback = ()=>{}) {
  var params = JSON.parse(goal.params)
  
  if (typeof settings.connections[goal.linktype] == 'undefined') { 
    return false
  }

  var link = parseLink(settings.connections[goal.linktype]['href'], params)
  var re = /^(?:http|https):\/\/\S*\.\S*/i
  if (!re.test(link)) { return false }
  
  if (link.substr(0,6) == 'https:') { var http_transport = https } 
  else                              { var http_transport = http }

  var req = http_transport.request(link, (res) => {
    var data = ''
    res.on('data', function (chunk) {
      data = data + chunk
    }).on('end', () => {
      var score = settings.connections[goal.linktype].parser(data)
      if(typeof score!= 'undefined' && score*1 == score) {
        callback(score)
      } else {
        error_callback('Incorrect data source')
      }
    })
  })
  
  req.on('error', (e) => {
    console.log('problem with request: ' + e.message)
    error_callback(e.message)
  })
  
  req.write('')
  req.end()
}

function parseLink(link, data) {
  var keys = link.match(/{{(\S*?)}}/)
  if(keys){
    keys.forEach( (key) => {
      if (typeof data[key] != 'undefined') {
        link = link.replace('{{'+key+'}}', data[key])
      }
    })
  }
  return link
}
