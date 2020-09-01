const _ = require("lodash");
const AuthenticationContext = require("adal-node").AuthenticationContext;
const Fhir = require("fhir.js");

// read in config and replace any default values with env specific ones
require('dotenv').config();
const config = require('./config.json');
const defaultConfig = config.default;
const environment = process.env.NODE_ENV || 'default';
const environmentConfig = config[environment];
const finalConfig = _.merge(defaultConfig, environmentConfig);

// best practice naming for globals
global.gConfig = finalConfig;

// add in the authority URL to the config
global.gConfig.authorityUrl = global.gConfig.authorityHostUrl + "/" + global.gConfig.tenant;

// Function that processes an array of patients; currently logs to console.
// TODO: Make this function write to your CosmosDB!
function processPatients(patients) {
  console.log("Env: " + environment);
  patients.forEach((patient, index) => {
    console.log(
      index +
        ":  " +
        patient.resource.id +
        ":  " +
        patient.resource.name[0].family +
        ", " +
        patient.resource.name[0].given[0]
    );
  });
}

/// Iterates through all patients on the FHIR server and passes them to callback in small chunks
async function foreachPatient(baseUrl, token, callback) {
  /// setup client
  var client = Fhir({
    baseUrl: baseUrl,
    auth: {
      bearer: token
    }
  });

  try {
    // grab the inital search response
    var response = await client.search({
      type: "Patient",
      query: {
        _count: 100,
        _page: 1
      }
    });

    var pageCount = 1;

    // callback
    callback(response.data.entry);
    console.log("-------------- PAGE: " + pageCount++ + " --------------" )

    // loop through remaining pages.
    var nextPage = response.data.link.find(link => link.relation === "next");

    while (nextPage !== undefined) {
      response = await client.nextPage({ bundle: response.data });
      callback(response.data.entry);
      console.log("-------------- PAGE: " + pageCount++ + " --------------" )
      nextPage = response.data.link.find(link => link.relation === "next");
    }
  } catch (err) {
    console.log("Failed - opps");
    console.log(err);
  }
}

/// Authenticates with AzureAD
function getAuthenticationToken(callback) {
  var context = new AuthenticationContext(global.gConfig.authorityUrl);
  context.acquireTokenWithClientCredentials(
    global.gConfig.resource,
    global.gConfig.applicationId,
    global.gConfig.clientSecret,
    (err, response) => {
      if (err) {
        console.log("Failed to get token!");
      } else {
        callback(response.accessToken);
      }
    }
  );
}

/// Do the thing!
getAuthenticationToken(token =>
  foreachPatient(
    global.gConfig.fhirApiUrl,
    token,
    processPatients
  )
);
