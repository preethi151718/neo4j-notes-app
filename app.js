require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const neo4j = require("neo4j-driver");
const path = require("path");

const app = express();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Test Neo4j Aura Connection
async function testConnection() {
  const session = driver.session();
  try {
    await session.run("RETURN 'Neo4j Aura Connected!' AS message");
    console.log("✅ Connected to Neo4j Aura!");
  } catch (err) {
    console.error("❌ Neo4j Connection Error:", err);
  } finally {
    await session.close();
  }
}
testConnection();
// Ensure 'No Category' exists at the beginning of your app
async function ensureNoCategoryExists() {
  const session = driver.session();
  try {
    // Check if "No Category" exists
    const result = await session.run(
      `MATCH (c:Category {name: "No Category"}) RETURN c`
    );

    if (result.records.length === 0) {
      // If "No Category" doesn't exist, create it
      await session.run("CREATE (:Category {name: 'No Category'})");
      console.log("✅ 'No Category' created!");
    }
  } catch (err) {
    console.error("Error ensuring 'No Category' exists:", err);
  } finally {
    await session.close();
  }
}

// Fetch Categories
async function getCategories() {
  const session = driver.session();
  try {
    const result = await session.run(
      "MATCH (c:Category) RETURN c.name AS name"
    );
    return result.records.map((r) => r.get("name"));
  } catch (err) {
    console.error("Error fetching categories:", err);
    return [];
  } finally {
    await session.close();
  }
}
app.get("/", async (req, res) => {
  const session = driver.session();
  const searchQuery = req.query.search || "";
  const selectedCategory = req.query.categories || "";

  try {
    const categories = await getCategories();

    if (searchQuery.trim()) {
      // If search query is provided
      result = await session.run(
        `MATCH (n:Note)-[:BELONGS_TO]->(c:Category) 
         WHERE (n.title CONTAINS $searchQuery OR n.content CONTAINS $searchQuery) 
         AND (c.name = $category OR $category = "")
         RETURN ID(n) AS id, n.title AS title, n.content AS content, 
                n.color AS color, n.pinned AS pinned, c.name AS category 
         ORDER BY n.pinned DESC, n.createdAt DESC`,
        { searchQuery: searchQuery.trim(), category: selectedCategory }
      );
    } else {
      result = await session.run(
        `MATCH (n:Note)-[:BELONGS_TO]->(c:Category) 
         WHERE c.name = $category OR $category = ""
         RETURN ID(n) AS id, n.title AS title, n.content AS content, 
                n.color AS color, n.pinned AS pinned, c.name AS category 
         ORDER BY n.pinned DESC, n.createdAt DESC`,
        { category: selectedCategory }
      );
    }

    const notes = result.records.map((r) => ({
      id: r.get("id").low,
      title: r.get("title"),
      content: r.get("content"),
      color: r.get("color"),
      pinned: r.get("pinned"),
      category: r.get("category"),
    }));

    res.render("index", { notes, categories, searchQuery, selectedCategory }); // Pass selectedCategory to template
  } catch (err) {
    res.status(500).send("Error fetching notes: " + err);
  } finally {
    await session.close();
  }
});

//  Update a Note
app.get("/edit/:id", async (req, res) => {
  const session = driver.session();
  try {
    // Fetch the note details and categories for the form
    const result = await session.run(
      `MATCH (n:Note)-[:BELONGS_TO]->(c:Category) WHERE ID(n) = $id 
       RETURN ID(n) AS id, n.title AS title, n.content AS content, 
              n.color AS color, n.pinned AS pinned, c.name AS category`,
      { id: parseInt(req.params.id) }
    );

    const note = result.records.length ? result.records[0] : null;
    if (!note) {
      return res.status(404).send("Note not found");
    }

    const categories = await getCategories(); // Fetch available categories

    res.render("edit", {
      note: {
        id: note.get("id").low,
        title: note.get("title"),
        content: note.get("content"),
        color: note.get("color"),
        pinned: note.get("pinned"),
        category: note.get("category"),
      },
      categories,
    });
  } catch (err) {
    res.status(500).send("Error fetching note: " + err);
  } finally {
    await session.close();
  }
});

app.post("/update/:id", async (req, res) => {
  const session = driver.session();
  const { title, content, color, pinned, category } = req.body;
  try {
    // Update note details and change the relationship to the new category
    await session.run(
      `MATCH (n:Note) WHERE ID(n) = $id
       MATCH (c:Category {name: $category})
       // Remove the current category relationship
       OPTIONAL MATCH (n)-[r:BELONGS_TO]->(oldCategory:Category)
       DELETE r
       // Create a new relationship with the new category
       MERGE (n)-[:BELONGS_TO]->(c)
       SET n.title = $title, n.content = $content, n.color = $color, 
           n.pinned = $pinned`,
      {
        id: parseInt(req.params.id),
        title,
        content,
        color,
        pinned: pinned === "true",
        category,
      }
    );
    res.redirect("/"); // Redirect after updating
  } catch (err) {
    res.status(500).send("Error updating note: " + err);
  } finally {
    await session.close();
  }
});

app.get("/note/:noteId", async (req, res) => {
  const noteId = req.params.noteId;

  try {
    const result = await driver
      .session()
      .run("MATCH (n:Note) WHERE ID(n) = $noteId RETURN n", {
        noteId: parseInt(noteId),
      });
    const note = result.records[0]?.get("n").properties;

    if (!note) {
      return res.status(404).send("Note not found");
    }

    res.json({
      title: note.title,
      content: note.content,
    });
  } catch (err) {
    console.error("Error fetching note:", err);
    res.status(500).send("Error fetching note");
  }
});

app.post("/pin/:id", async (req, res) => {
  const session = driver.session();
  try {
    const noteId = parseInt(req.params.id); // Convert ID to integer

    // Get the current pinned status
    const result = await session.run(
      `MATCH (n:Note) WHERE ID(n) = $id RETURN n.pinned AS pinned`,
      { id: noteId }
    );

    if (result.records.length === 0) {
      return res.status(404).send("Note not found");
    }

    const currentPinned = result.records[0].get("pinned");

    // Toggle the pinned status
    await session.run(
      `MATCH (n:Note) WHERE ID(n) = $id
       SET n.pinned = $newPinned`,
      { id: noteId, newPinned: !currentPinned }
    );

    console.log("Note pinned/unpinned successfully!");
    res.redirect("/"); // Refresh homepage after toggling
  } catch (err) {
    console.error("Error pinning/unpinning note:", err);
    res.status(500).send("Error pinning/unpinning note: " + err);
  } finally {
    await session.close();
  }
});

// Create a Category
app.post("/category", async (req, res) => {
  const session = driver.session();
  try {
    await session.run("CREATE (:Category {name: $name})", {
      name: req.body.name,
    });
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Error creating category: " + err);
  } finally {
    await session.close();
  }
});

// Create a Note
app.post("/new", async (req, res) => {
  const session = driver.session();
  const { title, content, color, pinned, category } = req.body;
  try {
    await session.run(
      `MATCH (c:Category {name: $category})
       CREATE (n:Note {title: $title, content: $content, color: $color, pinned: $pinned, createdAt: datetime()})-[:BELONGS_TO]->(c)`,
      { title, content, color, pinned: pinned === "true", category }
    );
    res.redirect("/"); // Redirect to the homepage after note creation
  } catch (err) {
    res.status(500).send("Error creating note: " + err);
  } finally {
    await session.close();
  }
});
app.post("/delete-category/:categoryName", async (req, res) => {
  const session = driver.session();
  const categoryName = req.params.categoryName;

  try {
    // Ensure 'No Category' exists before proceeding
    await ensureNoCategoryExists();

    // Move notes from the category to "No Category"
    await session.run(
      `MATCH (n:Note)-[r:BELONGS_TO]->(c:Category {name: $categoryName})
       MATCH (noCategory:Category {name: "No Category"})
       MERGE (n)-[:BELONGS_TO]->(noCategory)
       DELETE r`, // delete the old relationship
      { categoryName }
    );

    // Delete the category after reassignment
    await session.run(
      `MATCH (c:Category {name: $categoryName})
       DETACH DELETE c`,
      { categoryName }
    );

    res.redirect("/"); // Redirect to the homepage after deletion
  } catch (err) {
    res.status(500).send("Error deleting category: " + err);
  } finally {
    await session.close();
  }
});

// Delete a Note
app.post("/delete/:id", async (req, res) => {
  const session = driver.session();
  try {
    await session.run("MATCH (n:Note) WHERE ID(n) = $id DETACH DELETE n", {
      id: parseInt(req.params.id),
    });
    res.redirect("/");
  } catch (err) {
    res.status(500).send("Error deleting note: " + err);
  } finally {
    await session.close();
  }
});
// Render the "Create a New Note" form
app.get("/new", async (req, res) => {
  const categories = await getCategories(); // Fetch available categories
  res.render("new", { categories }); // Render a "new" template with categories
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(process.env.NEO4J_URI);
  console.log(process.env.NEO4J_USERNAME);
  console.log(process.env.NEO4J_PASSWORD);

  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
