var router = require('express').Router();
const admin = require('firebase-admin');
const checksum_lib = require('./paytm/checksum');
const serviceAccount = require('../serviceAccountKey.json');
const paytm_config = require('./paytm/paytm_config');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

function getUnique(array) {
    var uniqueArray = [];
    for (i = 0; i < array.length; i++) {
        if (uniqueArray.indexOf(array[i]) === -1) {
            uniqueArray.push(array[i]);
        }
    }
    return uniqueArray;
}

router.post('/payment_checkout', function (req, res) {
    try {
        var userid = req.body.userid;
        var eventList = req.body.events;
        var email = req.body.email;
        if (userid != undefined && userid != "" && eventList.length != 0 && email != undefined && email != "") {
            eventList = getUnique(eventList);
            console.log(userid);
            console.log(eventList)
            var txn_amount = 0;
            var finalEventsList = [];
            var eventsData = {};
            var eventsDataRef = db.collection('events');
            eventsDataRef.get()
                .then(snapshot => {
                    snapshot.forEach(doc => {
                        console.log(doc.id, '=>', doc.data());
                        if (eventList.includes(doc.id)) {
                            txn_amount = txn_amount + doc.data().price;
                            finalEventsList.push(doc.id);
                            eventsData[doc.id] = doc.data().price;
                        }
                    });
                    if (finalEventsList.length != eventList.length) {
                        res.status(404).send("Dont't be smart!");
                    }
                    var userDetaislRef = db.collection('users').doc(userid);
                    userDetaislRef.get()
                        .then(doc => {
                            if (doc.exists) {
                                (doc.data().events).forEach(element => {
                                    if (finalEventsList.includes(element)) {
                                        var index = finalEventsList.indexOf(element);
                                        finalEventsList.splice(index, index);
                                        txn_amount = txn_amount - eventsData[element];
                                    }
                                });
                            }
                            console.log("Amount to be paid: " + txn_amount)
                            if (txn_amount <= 0) {
                                res.status(404).send("Payment can't be made!");
                            }
                            var orders = db.collection("orders");
                            orders.add({
                                userid: userid,
                                email: email,
                                txn_amount: txn_amount,
                                events: finalEventsList,
                                paid: false,
                                time: Date.now()
                            }).then(ref => {
                                console.log('Order ID: ', ref.id);
                                var orderid = ref.id;
                                var paytmParams = {
                                    "MID": paytm_config.MID,
                                    "WEBSITE": paytm_config.WEBSITE,
                                    "INDUSTRY_TYPE_ID": paytm_config.INDUSTRY_TYPE_ID,
                                    "CHANNEL_ID": paytm_config.CHANNEL_ID,
                                    "ORDER_ID": orderid,
                                    "CUST_ID": userid,
                                    "TXN_AMOUNT": String(txn_amount),
                                    "CALLBACK_URL": "https://us-central1-prakarshweb.cloudfunctions.net/app/api/callback",
                                };
                                checksum_lib.genchecksum(paytmParams, paytm_config.MERCHANT_KEY, function (err, checksum) {
                                    if (err) {
                                        res.status(404).send("Error!");
                                    }
                                    /* for Staging */
                                    var url = "https://securegw-stage.paytm.in/order/process";
                                    /* for Production */
                                    // var url = "https://securegw.paytm.in/order/process";

                                    var output = "";
                                    output += '<html>';
                                    output += '<head>';
                                    output += '<title>Merchant Checkout Page</title>';
                                    output += '</head>';
                                    output += '<body>';
                                    output += '<center><h1>Please do not refresh this page...</h1></center>';
                                    output += '<form method="post" action="' + url + '" name="paytm_form">';
                                    for (var x in paytmParams) {
                                        output += '<input type="hidden" name="' + x + '" value="' + paytmParams[x] + '">';
                                    }
                                    output += '<input type="hidden" name="CHECKSUMHASH" value="' + checksum + '">';
                                    output += '</form>';
                                    output += '<script type="text/javascript">';
                                    output += 'document.paytm_form.submit();';
                                    output += '</script>';
                                    output += '</body>';
                                    output += '</html>';
                                    res.send(output);
                                });

                            });

                        })
                        .catch(err => {
                            console.log('Error getting document', err);
                            res.status(404).send("Error!");
                        });
                })
                .catch(err => {
                    console.log('Error getting snapshot', err);
                    res.status(404).send("Error!");
                });

        } else {
            res.status(404).send("Bad request!")
        }

    } catch (err) {
        console.log("Error inside payment_chekout:" + err);
        res.status(404).send("Error!");
    }

});


router.post('/callback', function (req, res) {

    try {
        var checksum = req.body.CHECKSUMHASH;
        var txn_amount = req.body.TXNAMOUNT;
        var order_id = req.body.ORDERID;
        var txn_id = req.body.TXNID;
        var txn_date = req.body.TXNDATE;
        var status = req.body.STATUS;
        var paytmParams = {};
        var received_data = req.body;
        for (var key in received_data) {
            if (key != "CHECKSUMHASH") {
                paytmParams[key] = received_data[key];
            }
        }
        var isValidChecksum = checksum_lib.verifychecksum(paytmParams, paytm_config.MERCHANT_KEY, checksum);
        if (isValidChecksum) {
            console.log("checksum is valid");
            if (status == "TXN_SUCCESS") {
                var transactionRef = db.collection('transactions').doc(txn_id);
                transactionRef.get()
                    .then(doc => {
                        if (!doc.exists) {
                            var orderRef = db.collection('orders').doc(order_id);
                            orderRef.get()
                                .then(doc => {
                                    if (!doc.exists) {
                                        res.status(404).send("Order doesn't exist!");
                                    } else {
                                        if (doc.data().paid) {
                                            res.status(404).send("Don't be smart!");
                                        } else {
                                            var eventsTaken = doc.data().events;
                                            var userid = doc.data().userid;
                                            var email = doc.data().email;
                                            var txn_amount_check = 0;
                                            var eventsRef = db.collection('events');
                                            eventsRef.get()
                                                .then(snapshot => {
                                                    snapshot.forEach(doc => {
                                                        if (eventsTaken.includes(doc.id)) {
                                                            txn_amount_check = txn_amount_check + doc.data().price;
                                                        }
                                                    });
                                                    if (txn_amount_check == Number(txn_amount)) {
                                                        orderRef.update({
                                                            paid: true
                                                        });
                                                        let data = {
                                                            order_id: order_id,
                                                            txn_amount: txn_amount,
                                                            txn_date: txn_date,
                                                            checksum: checksum
                                                        }
                                                        db.collection('transactions').doc(txn_id).set(data);
                                                        var userRef = db.collection('users').doc(userid);
                                                        userRef.get()
                                                            .then(doc => {
                                                                if (!doc.exists) {
                                                                    let data = {
                                                                        email: email,
                                                                        events: eventsTaken,
                                                                        orders: [order_id],
                                                                        transactions: [txn_id]
                                                                    }
                                                                    db.collection('users').doc(userid).set(data);
                                                                    res.send("Payment sucessfully completed!<br>TO check your orders visit https://us-central1-prakarshweb.cloudfunctions.net/app/api/user/" + userid);
                                                                } else {
                                                                    var current_events_taken = doc.data().events;
                                                                    var current_paid_orders = doc.data().orders;
                                                                    var current_paid_transactions = doc.data().transactions;
                                                                    current_paid_orders.push(order_id);
                                                                    current_paid_transactions.push(txn_id);
                                                                    current_events_taken = current_events_taken.concat(eventsTaken);
                                                                    userRef.update({
                                                                        events: current_events_taken,
                                                                        orders: current_paid_orders,
                                                                        transactions: current_paid_transactions
                                                                    });
                                                                    res.send("Payment sucessfully completed!<br>TO check your orders visit https://us-central1-prakarshweb.cloudfunctions.net/app/api/user/" + userid);
                                                                }
                                                            })
                                                            .catch(err => {
                                                                console.log('Error getting document', err);
                                                                res.status(404).send("Error!");
                                                            });

                                                    } else {
                                                        res.status(404).send("Don't be smart!");
                                                    }
                                                })
                                                .catch(err => {
                                                    console.log('Error getting documents', err);
                                                    res.status(404).send("Error!");
                                                });

                                        }
                                    }
                                })
                                .catch(err => {
                                    console.log('Error getting document', err);
                                    res.status(404).send("Error!");
                                });

                        } else {
                            res.status(404).send("Don't be smart!");
                        }
                    })
                    .catch(err => {
                        console.log('Error getting document', err);
                        res.status(404).send("Error!");
                    });
            } else {
                res.status(404).send("payment unsucessful!");
            }
        }

    } catch (err) {
        console.log("Err:", err);
        res.status(404).send("Error!");

    }

});

router.get('/user/:userid', function (req, res) {
    var userRef = db.collection('users').doc(req.params.userid);
    userRef.get()
        .then(doc => {
            if (!doc.exists) {
                console.log('No such document!');
                res.send("user does not exist!");
            } else {
                var output = "";
                var events = doc.data().events;
                var eventsRef = db.collection('events');
                eventsRef.get()
                    .then(snapshot => {
                        snapshot.forEach(doc => {
                            if (events.includes(doc.id)) {
                                output += doc.data().name + " " + doc.data().price + "rs" + "<br>"
                            }
                        });
                        res.send(output)
                    })
                    .catch(err => {
                        console.log('Error getting documents', err);
                        res.status(404).send("Error!");
                    });

            }
        })
        .catch(err => {
            console.log('Error getting document', err);
            res.status(404).send("Error!")
        });
})
router.get('/events', function (req, res) {
    var eventsRef = db.collection('events');
    eventsRef.get()
        .then(snapshot => {
            if (snapshot.empty) {
                console.log('No matching documents.');
                res.status(404).send("Error!");
                return;
            }
            var output = {}
            snapshot.forEach(doc => {
                var temp = []
                temp.push(doc.data().name)
                temp.push(doc.data().price)
                temp.push(doc.data().type)
                output[doc.id] = temp;

            });
            res.send("mydatfunc(" + JSON.stringify(output) + ")")
        })
        .catch(err => {
            console.log('Error getting documents', err);
            res.status(404).send("Error!");
        });
})
module.exports = router;