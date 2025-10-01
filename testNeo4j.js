require("dotenv").config(); // Load .env variables
const neo4j = require("neo4j-driver");

// Use environment variables or replace with your details
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

async function testConnection() {
  try {
    await driver.verifyConnectivity();
    console.log("✅ Connected to Neo4j Aura successfully!");
  } catch (err) {
    console.error("❌ Connection failed:", err);
  } finally {
    await driver.close();
  }
}

testConnection();
