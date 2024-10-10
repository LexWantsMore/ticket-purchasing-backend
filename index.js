const express = require("express");
const app = express();
require("dotenv").config();
const http = require("http");
const bodyParser = require("body-parser");
const cors = require("cors");
const apiRouter = require('./api'); // Import the API routes

const port = process.env.PORT;
const hostname = "localhost";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());
app.use('/', apiRouter); // Use the API routes

const server = http.createServer(app);

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
