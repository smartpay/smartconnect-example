// ******************************************************************************
// The code below will handle the SmartConnect API endpoint communication.
// SmartConnect API endpoints are CORS-enabled, so the calls can be made from the front-end.
// ******************************************************************************

// This base URL points to the DEV environment, against which all development and testing should be done.
// When deploying your app to production, make sure to remember to have a way to change this URL to use PROD endpoints.
const _baseUrl = "https://api-dev.smart-connect.cloud/POS";

// Register ID. *Must* be unique across *all* of your customers using your POS. The same ID must be sent for both
// pairing and transaction requests. A UUID is generally convenient here, though it doesn't need to be a UUID.
const _posRegisterId = "6bd3bf1c-11cb-42ae-92c7-46ac39680166";

// The name of the register. Only used during pairing. This will be displayed on the device itself (to easily
// visually identify where it is paired to).
const _posRegisterName = "Register 1";

// The merchant name of your customer. *Must* be consistent between pairing and transaction requests.
// Side note: If the customer chooses to change their business name, a new pairing request needs to be issued.
const _posBusinessName = "Demo Shop";

// The name of your POS application. *Must* be consistent between pairing and transaction requests.
const _posVendorName = "Test POS";

// This "enum" will be used to return back the final transaction outcome after polling is complete.
//
// The transaction outcome is generally decided by two parameters inside the result JSON: TransactionResult and data.Result.
//
// *TransactionResult* is the actual outcome of the transaction.
// Possible values are: OK-ACCEPTED, OK-DECLINED, OK-UNAVAILABLE, OK-DELAYED, CANCELLED, FAILED, FAILED-INTERFACE
//
// *Result* indicates if the function was performed _successfuly_ (a Declined outcome is also a function performed successfuly).
// Possible values are: OK, CANCELLED, DELAYED-TRANSACTION, FAILED, FAILED-INTERFACE.
//
// For a full reference on the transaction outcome, see: http://www.smartpayinvestor.com/smartconnect-api-integration-guide/
//
// From the point of view of the POS, TransactionResult is the main determinant of the outcome of the transaction.
// Result can be used as a complementary field, the major use being to distinguish Cancelled transactions between
// the user pressing Cancel on the device, from the device being offline.
//
// The scenarios below capture the outcomes we'd want to handle on the interface.
const TransactionOutcome = Object.freeze({
  "Accepted": 1, // TransactionResult = "OK-ACCEPTED"
  "Declined": 2, // TransactionResult = "OK-DECLINED"
  "Cancelled": 3, // TransactionResult = "CANCELLED", Result != "FAILED-INTERFACE"
  "DeviceOffline": 4, // TransactionResult = "CANCELLED", Result = "FAILED-INTERFACE"
  "Failed": 5 // Everything else
});

// ======================================================
// PAIRING REQUEST
//
// Parameters:
// - pairingCode (required) - The code as displayed on the device, and inputted by the user
//
// Returns:
// - a JS Promise with the outcome (resolve, no object passed back / reject, error message passed back)
// ======================================================
function sendParingRequest(pairingCode) {

  return new Promise((resolve, reject) => {

    if (!pairingCode) {
      reject("A pairing code has to be supplied.");
      return;
    }

    const pairingEndpoint = _baseUrl + "/Pairing/" + pairingCode;

    const parameters = {
      POSRegisterID: _posRegisterId,
      POSRegisterName: _posRegisterName,
      POSBusinessName: _posBusinessName,
      POSVendorName: _posVendorName
    };

    console.log("Sending pairing request to: " + pairingEndpoint);
    console.log("Pairing parameters: " + JSON.stringify(parameters));

    // Note that a PUT is required. Any other method will return with a 404 Not Found.
    $.ajax({
      url: pairingEndpoint,
      type: "PUT",
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      data: parameters,
      success: function (responseData, textStatus, jqXHR) {

        // success function invoked when 2xx OK is received
        try {

          console.log("Pairing response received (" + jqXHR.status + "): " + jqXHR.responseText);

          // Trust, but verify
          if (jqXHR.status == 200) {

            // No object passed back
            resolve();
            return;

          } else {

            // We don't really expect anything other than 200 in here, but you never know...
            reject("Invalid status code received");
            return;
          }

        } catch (error) {
          // Catch code errors (parsing failure, etc.)
          reject(error);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {

        // error function invoked when anything other than 2xx OK is received

        console.log("Pairing response received (" + jqXHR.status + "): " + jqXHR.responseText);

        // Generally, if it's an "expected" error (e.g. invalid/expired pairing code), a 4xx will be returned
        // and a JSON description of the error provided (except for 404 Not Found). For example:
        //
        // { "error": "Invalid Pairing Code. Please make sure you entered the code correctly" } (400 Bad Request)
        //
        // We will only fall back to errorThrown if this is not present (i.e. if a 5xx server error happens instead).
        // errorThrown will be a generic "Internal Server Error" etc. as per the status code.
        let error = (jqXHR && jqXHR.responseText && JSON.parse(jqXHR.responseText).error)
          ? JSON.parse(jqXHR.responseText).error : errorThrown;

        // For the purpose of this example, we will treat all errors "equally" and just surface the error
        // message back, however you may wish to at least differentiate between 4xx and 5xx errors in a
        // production implementation (i.e. errors that have a message and can be caught versus call/server failure).
        reject(error);
      }
    });
  });
}

// ======================================================
// CREATE TRANSACTION
//
// Parameters:
// - amount (required) - The amount in cents ($1.99 should be supplied as 199). Currency is not required,
//     will fall back to the default currency on the device
// - transactionType (required) - The function on the device to invoke (e.g. Card.Purchase, Card.Refund, etc.)
//
// Returns:
// - a JS Promise with the outcome:
//     - resolve(string) - the string will contain the polling url
//     - reject(string) - the string will contain the error message
// ======================================================
function createTransaction(amount, transactionType) {

  // To get the transaction outcome, at least two asynchronous requests will be needed.
  // The first request will POST the transaction parameters to the endpoint, and obtain a
  // polling URL. The client will then continue polling (executing GET against that URL)
  // until the actual final outcome of the transaction is received.

  // This function will return that polling URL via the resolve function.

  return new Promise((resolve, reject) => {

    if (!amount) {

      reject("The amount has to be supplied");
      return;

    } else if (!(+amount === parseInt(amount))) {

      reject("The provided amount is not a valid integer");
      return;

    } else if (!transactionType) {

      reject("The transactionType has to be supplied");
      return;
      // Will not perform additional validation on TransactionType here, the server will reject it
      // in case it is invalid.
    }

    const transactionEndpoint = _baseUrl + "/Transaction";

    // Some transaction types allow for additional fields (e.g. Card.PurchasePlusCash will require the
    // AmountCash value to be supplied as well), however for simplicity reasons those will be omitted here.
    // For the full API reference, see: http://www.smartpayinvestor.com/smartconnect-api-integration-guide/
    const parameters = {
      POSRegisterID: _posRegisterId,
      POSBusinessName: _posBusinessName,
      POSVendorName: _posVendorName,
      TransactionMode: "ASYNC",
      TransactionType: transactionType,
      AmountTotal: amount
    };

    console.log("Sending transaction POST request to: " + transactionEndpoint);
    console.log("Transaction parameters: " + JSON.stringify(parameters));

    // Note that a POST is required. Any other method will return with a 404 Not Found.
    $.ajax({
      url: transactionEndpoint,
      type: "POST",
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      data: parameters,
      success: function (responseData, textStatus, jqXHR) {

        // success function invoked when 2xx OK is received
        try {

          console.log("Transaction POST response received (" + jqXHR.status + "): " + jqXHR.responseText);

          // Trust, but verify
          if (jqXHR.status == 200) {

            // Extract the polling URL
            let response = JSON.parse(jqXHR.responseText);

            if (response && response.data && response.data.PollingUrl) {

              // return the polling URL
              resolve(response.data.PollingUrl);
              return;

            } else {

              // Something's not quite right here - not very likely to happen, but you never know...
              reject("Returned 200 but Polling URL missing");
              return;
            }

          } else {

            // We don't really expect anything other than 200 in here, but you never know...
            reject("Invalid status code received");
            return;
          }

        } catch (error) {
          // Catch code errors (parsing failure, etc.)
          reject(error);
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {

        // error function invoked when anything other than 2xx OK is received

        console.log("Transaction POST response received (" + jqXHR.status + "): " + jqXHR.responseText);

        // Generally, if it's an "expected" error (e.g. no device is paired), a 4xx will be returned
        // and a JSON description of the error provided (except for 404 Not Found). For example:
        // { "error": "This register is not paired to a device, please pair it first." } (400 Bad Request)
        // or
        // { "error": "device is busy" } (429 Too Many Requests)
        //
        // We will only fall back to errorThrown if this is not present (i.e. if a 5xx server error happens instead).
        // errorThrown will be a generic "Internal Server Error" etc. as per the status code.
        let error = (jqXHR && jqXHR.responseText) ? JSON.parse(jqXHR.responseText).error : errorThrown;

        // For the purpose of this example, we will treat all errors "equally" and just surface the error
        // message back, however you may wish to at least differentiate between 4xx and 5xx errors in a
        // production implementation (i.e. errors that have a message and can be caught versus call/server failure).
        reject(error);
      }
    });
  });
}

// =====================================================
// POLL FOR THE FINAL OUTCOME OF THE TRANSACTION
//
// Parameters:
// - pollingUrl (required) - URL obtained through the createTransaction() function
// - delayed (optional) - the function to invoke if the transaction enters a "Delayed" state
//     See the API reference for information on the Delayed state.
//
// Returns:
// - a JS Promise with the outcome:
//     - resolve(TransactionOutcome, responseData) - one of the outcomes to handle on the "interface" and
//       the response data from the jqXHR object
//     - reject(string) - the string will contain the error message
// =====================================================
function pollForOutcome(pollingUrl, delayed) {

  // Polling interval on the PROD server will be rate limited to 2 seconds.

  // It's a bad idea to let the polling run indefinitely, so will set an overall timeout to
  // 10 minutes. Generally, no customer will wait for 10 minutes for an outcome, so ideally
  // in production code there would be a way to interrupt the polling and finish the transaction
  // manually (in case the device got completely bricked or something went wrong the API server).

  // Generally, if the device temporarily dies (temporary Internet outage, power loss, etc) - it will
  // upload the result to the API server the moment it comes back online.

  const interval = 2 * 1000; // 2 seconds
  const timeout = 10 * 60 * 1000; // 10 minutes

  const endTime = Number(new Date()) + timeout;

  var checkCondition = function(resolve, reject) {

    if (!pollingUrl) {
      reject("Polling URL needs to be submitted");
      return;
    }

    console.log("Polling for outcome: " + pollingUrl);

    // Note that a GET is required. Any other method will return with a 404 Not Found.
    $.ajax({
      url: pollingUrl,
      type: "GET",
      complete: function(jqXHR, textStatus) {

        // Gets called after *either* success or error are called
        try {

          console.log("Transaction GET response received (" + jqXHR.status + "): " + jqXHR.responseText);

          let transactionComplete = false;
          let transactionOutcome;

          if (jqXHR.status == 200) {

            let response = JSON.parse(jqXHR.responseText);

            if (response && response.data) {

              let transactionStatus = response.transactionStatus;
              let transactionResult = response.data.TransactionResult;
              let result = response.data.Result;

              if (transactionStatus == "COMPLETED") {

                // Transaction is concluded, no need to continue polling
                transactionComplete = true;

                // Determine the outcome of the transaction
                if (transactionResult == "OK-ACCEPTED") {

                  transactionOutcome = TransactionOutcome.Accepted;

                } else if (transactionResult == "OK-DECLINED") {

                  transactionOutcome = TransactionOutcome.Declined;

                } else if (transactionResult == "CANCELLED" && result != "FAILED-INTERFACE") {

                  transactionOutcome = TransactionOutcome.Cancelled;

                } else if (transactionResult == "CANCELLED" && result == "FAILED-INTERFACE") {

                  transactionOutcome = TransactionOutcome.DeviceOffline;

                } else {

                  // Everything else is pretty-much a failed outcome
                  transactionOutcome = TransactionOutcome.Failed;
                }

              } else if (transactionStatus == "PENDING" && transactionResult == "OK-DELAYED" && delayed) {

                // Transaction still not done, but server reporting it's taking longer than usual
                // Invoke the delayed function - POS may choose to display a visual indication to the user
                // (in case e.g. the device lost connectivity and is not able to upload the outcome)
                delayed();

                // Will still continue to poll...
              }

            } else {

              // Something's not quite right here - not very likely to happen, but you never know...
              reject("Returned 200 but data structure not as expected");
              return;
            }

          } else {

            // We do not expect the server to return a 4xx error for a "known" reason at this stage
            // If the request has failed, it's most likely with something on the infrastructure level
            // (e.g. Internet down on client or server offline/unreachable)

            // We will silently ignore this and continue polling
            console.log("Ignoring failed request...")
          }

          // Determine if we should continue with the recursion (polling) or not
          if (transactionComplete && transactionOutcome) {

            // All done!
            resolve(transactionOutcome, jqXHR.responseText);
            return;

          } else if (Number(new Date()) < endTime) {

            // If the condition isn't met but the timeout hasn't elapsed, go again
            setTimeout(checkCondition, interval, resolve, reject);
            return;

          } else {

            // Didn't match and too much time, reject!
            reject("Polling timed out");
            return;
          }

        } catch (error) {
          // Catch code errors (parsing failure, etc.)
          reject(error);
        }
      }
    });
  };

  return new Promise(checkCondition);
}
