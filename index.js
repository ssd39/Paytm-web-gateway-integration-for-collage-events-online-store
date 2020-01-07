const functions = require('firebase-functions');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var payment_api = require('./src/payment_controller');
const path = require('path');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views')));
var port = process.env.PORT;

var router = express.Router();

router.use('/api', payment_api);
router.get('/', function (req, res) {
    res.render('./views/index.html');
})

app.use('/', router);

app.listen(port);
exports.app = functions.https.onRequest(app);