const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
const chance = require("chance").Chance();

dotenv.config();


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_API_KEY
);

// Get all memories for a user
async function getUserMemory(userId, limit = 5) {
  console.log("💾 Querying database for memories... related to user:", userId);
  const { data, error } = await supabase
    .from("storage")
    .select("*")
    
    // limit to the last 50 memories
    .limit(limit)
    // sort so the most recent memories are first by timestamp
    .order("created_at", { ascending: false })
    .eq("user_id", userId)
    // and the value is not ✨
    .neq("value", "✨");

  if (error) {
    console.error("Error fetching user memory:", error);
    return null;
  }

  return data;
}

// use pgvector cosine similarity to find memories similar to the prompt input
// async function getSimilarMemories(prompt, limit = 5) {
//   console.log("💾 Querying database for similar memories...");
//   const { data, error } = await supabase.rpc("find_similar_memories", {
//     prompt,
//     limit,
//   });

//   if (error) {
//     console.error("Error fetching similar memories:", error);
//     return null;
//   }

//   return data;
// }


// get all memories (regardless of user)
async function getAllMemories(limit = 250) {
  // re-factor to pick a random 100 memories
  const { data, error } = await supabase
    .from("storage")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);



  if (error) {
    console.error("Error fetching user memory:", error);
    return null;
  }

  return data;
}

// Get all memories for a search term
// async function getSearchTermMemories(searchTerm, limit = 40) {
//   const { data, error } = await supabase
//     .from("storage")
//     .select("*")
//     // limit to the last 50 memories
//     .limit(limit)
//     .ilike("value", `%${searchTerm}%`);

//   if (error) {
//     console.error("Error fetching user memory:", error);
//     return null;
//   }

//   return data;
// }

// Get message history for a user
async function getUserMessageHistory(userId, limit = 5) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .limit(limit)
    // sort so we get the most recent messages last
    .order("created_at", { ascending: false })
    .eq("user_id", userId);

  if (error) {
    console.error("Error fetching user memory:", error);
    return null;
  }

  return data;
}

// Store a memory for a user
async function storeUserMemory(userId, value) {
  const { data, error } = await supabase.from("storage").insert([
    {
      user_id: userId,
      value,
    },
  ]);

  if (error) {
    console.error("Error storing user memory:", error);
  }
}

// Store a message from a user
async function storeUserMessage(userId, value) {
  const { data, error } = await supabase.from("messages").insert([
    {
      user_id: userId,
      value,
    },
  ]);

  if (error) {
    console.error("Error storing user message:", error);
  }
}

// Get a random N number of memories
// async function getRandomMemories(numberOfMemories) {
//   // const memories = await getUserMemory(userId);
//   const memories = await getAllMemories();

//   if (!memories) {
//     console.error("Error getting random memories");
//     return [];
//   }
//   if (memories && memories.length > 0) {
//     const randomMemories = chance.pickset(memories, numberOfMemories);
//     return randomMemories; //.map(memory => memory.value);
//   }

//   return [];
// }


// Given a message, return the last 5 memories and the last 5 messages
async function assembleMemory(user, randomMemoryCount = 25) {
  try {
    if(!user) {
      console.error("No user provided to assembleMemory");
      return [];
    }
    // Get the last X memories for the current user
    const memories = await getUserMemory(user, 5);

    console.log(' assembling memories for user: ', memories);

    // get X random memories
    // const randomMemories = await getRandomMemories(randomMemoryCount);

    // Concat the memories and messages
    const memory = [
      ...new Set([
        ...memories.map(mem => mem.value)
        // ...randomMemories,
      ]),
    ];

    return memory;
  } catch (e) {
    console.error("assembleMemory error: ", e);
  }
}

// Interpret the response when we ask the robot "should we remember this?"
function isRememberResponseFalsy(response) {
  const lowerCaseResponse = response.toLocaleLowerCase();

  // is the string 'no.' or 'no'?
  if (lowerCaseResponse === "no" || lowerCaseResponse === "no.") {
    return true;
  }

  // does the string contain 'no crucial' or 'no important'?
  if (
    lowerCaseResponse.includes("no crucial") ||
    lowerCaseResponse.includes("no important") ||
    lowerCaseResponse.includes("✨")
  ) {
    return true;
  }

  // does the string contain 'no key details'?
  if (lowerCaseResponse.includes("no key details")) {
    return true;
  }
}

module.exports = {
  getUserMemory,
  getUserMessageHistory,
  storeUserMemory,
  getAllMemories,
  storeUserMessage,
  assembleMemory,
  isRememberResponseFalsy,
};