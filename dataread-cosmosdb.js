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

// For cosmosdb
const CosmosClient = require('@azure/cosmos').CosmosClient;
const configcosmosdb = require('./config');
const endpoint = configcosmosdb.endpoint;
const masterKey = configcosmosdb.primaryKey;
const client = new CosmosClient({ endpoint: endpoint, auth: { masterKey: masterKey } });
const HttpStatusCodes = { NOTFOUND: 404 };
const databaseId = configcosmosdb.database.id;
const containerId = configcosmosdb.container.id;

// best practice naming for globals
global.gConfig = finalConfig;

// add in the authority URL to the config
global.gConfig.authorityUrl = global.gConfig.authorityHostUrl + "/" + global.gConfig.tenant;

// Function that processes an array of patients; currently logs to console.
// TODO: Make this function write to your CosmosDB!
function processPatients(patients) {
  console.log("env: " + environment);
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

    // Insert into CosmosDB
    
    console.log("\n1. insert items in to database '" + databaseId + "' and container '" + containerId + "'");
    const itemDefs = patients;
    const p = [];
    for (const itemDef of itemDefs) {
      p.push(container.items.create(itemDef));
    }
    await Promise.all(p);
    console.log(itemDefs.length + " items created");
    
   /*
    createDatabase()
   .then(() => readDatabase())
   .then(() => createContainer())
   .then(() => readContainer())
   .then(() => createFamilyItem(patient))
  
   .then(() => { exit(`Completed successfully`); })
   .catch((error) => { exit(`Completed with error ${JSON.stringify(error)}`) });
    */

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


// CosmosDB utility funcrtions:
/**
* Create the database if it does not exist
*/
async function createDatabase() {
  const { database } = await client.databases.createIfNotExists({ id: databaseId });
  //console.log(`Created database:\n${database.id}\n`);
}

/**
* Read the database definition
*/
async function readDatabase() {
  const { body: databaseDefinition } = await client.database(databaseId).read();
  console.log(`Reading database:\n${databaseDefinition.id}\n`);
}

/**
* Create the container if it does not exist
*/
async function createContainer() {
  const { container } = await client.database(databaseId).containers.createIfNotExists({ id: containerId });
  console.log(`Created container:\n${config.container.id}\n`);
}

/**
* Read the container definition
*/
async function readContainer() {
  const { body: containerDefinition } = await client.database(databaseId).container(containerId).read();
  console.log(`Reading container:\n${containerDefinition.id}\n`);
}

/**
* Create family item if it does not exist
*/
async function createFamilyItem(itemBody) {
    try {
        // read the item to see if it exists
        const { item } = await client.database(databaseId).container(containerId).item(itemBody.id).read();
        console.log(`Item with family id ${itemBody.id} already exists\n`);
    }
    catch (error) {
       // create the family item if it does not exist
       if (error.code === HttpStatusCodes.NOTFOUND) {
           const { item } = await client.database(databaseId).container(containerId).items.create(itemBody);
           console.log(`Created family item with id:\n${itemBody.id}\n`);
       } else {
           throw error;
       }
    }
  };

  /**
* Query the container using SQL
 */
async function queryContainer() {
    console.log(`Querying container:\n${config.container.id}`);
  
    // query to return all children in a family
    const querySpec = {
       query: "SELECT VALUE r.children FROM root r WHERE r.lastName = @lastName",
       parameters: [
           {
               name: "@lastName",
               value: "Andersen"
           }
       ]
   };
  
   const { result: results } = await client.database(databaseId).container(containerId).items.query(querySpec).toArray();
   for (var queryResult of results) {
       let resultString = JSON.stringify(queryResult);
       console.log(`\tQuery returned ${resultString}\n`);
   }
  };

  // ADD THIS PART TO YOUR CODE
/**
* Replace the item by ID.
*/
async function replaceFamilyItem(itemBody) {
    console.log(`Replacing item:\n${itemBody.id}\n`);
    // Change property 'grade'
    itemBody.children[0].grade = 6;
    const { item } = await client.database(databaseId).container(containerId).item(itemBody.id).replace(itemBody);
 };



/**
* Exit the app with a prompt
* @param {message} message - The message to display
*/
function exit(message) {
  console.log(message);
  console.log('Press any key to exit');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', process.exit.bind(process, 0));
}

/**
* Delete the item by ID.
*/
async function deleteFamilyItem(itemBody) {
    await client.database(databaseId).container(containerId).item(itemBody.id).delete(itemBody);
    console.log(`Deleted item:\n${itemBody.id}\n`);
 };

 /**
* Cleanup the database and container on completion
*/
async function cleanup() {
    await client.database(databaseId).delete();
  }




module.exports = async function(context, req) {
  /// Do the thing!
  const token = await getAuthenticationToken(context);
  await foreachPatient(
    global.gConfig.fhirApiUrl,
    token,
    context,
    processPatients
  );
};
