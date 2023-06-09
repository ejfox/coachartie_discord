// const { Client, GatewayIntentBits, Events } = require('discord.js');
// const axios = require('axios');
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const { Configuration, OpenAIApi } = require("openai");
// const { TwitterApi } = require('twitter-api-v2')
// const chance = require('chance').Chance();
const puppeteer = require("puppeteer");
const { fstat } = require("fs");
const { WEBPAGE_UNDERSTANDER_PROMPT } = require("./prompts");
const { encode, decode } = require("@nem035/gpt-3-encoder");
const { fs } = require("fs");
// import chance
const chance = require('chance').Chance();


dotenv.config();

const configuration = new Configuration({
  organization: process.env.OPENAI_API_ORGANIZATION,
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// This file will serve as a module used by the main discord bot in index.js

// The purpose of this file is to enable basic web browser access for the robot: given a URL, access it, parse it as JSON, and return the page contents to the main bot.

// Get the text from all text-like elements
// const allowedTextEls = 'p, h1, h2, h3, h4, h5, h6, a, span, div, td, th, tr, table, blockquote, pre, code, em, strong, i, b, u, s, sub, sup, small, big, q, cite, main, nav';

const allowedTextEls = "p, h1, h2, h3, h4, h5, h6, a, td, th, tr, pre, code, blockquote";


// quick promise sleep function
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchAndParseURL(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);

  console.log("🕸️  Navigating to " + url);

  // wait for body to load
  await page.waitForSelector("body");

  // get the page title and description
  const title = await page.title();

  // go through every element on the page and extract just the visible text, and concatenate into one long string
  const text = await page.$$eval(allowedTextEls, function (elements) {
    function trimHref(href) {
      // given a string like https://nytimes.com/article/12345, return /article/12345
      try {
        const url = new URL(href);
        return url.pathname;
      } catch (e) {
        return href;
      }
    }

    return elements
      .map((element) => {
        // sanitize any HTML content out of the text
        // return element.textContent.replace(/<[^>]*>?/gm, '') + ' ';
        // if <pre> wrap in backticks
        if (element.tagName === "PRE") {
          return (
            "```\n" + element.textContent.replace(/<[^>]*>?/gm, "") + "\n```"
          );
        }

        // if it is a link, grab the URL out too
        if (element.tagName === "A") {
          return (
            element.textContent.replace(/<[^>]*>?/gm, "")
            +
            " (" +
            // element.href +
            trimHref(element.href) +
            ") "
          );
        }

        return element.textContent.replace(/<[^>]*>?/gm, "") + " ";
      })
      .join(' ')
      // .join("\n");
  });

  // trim whitespace out of the text
  const trimmedText = text.replace(/\s+/g, " ").trim();

  console.log("📝  Page raw text:", trimmedText);

  await browser.close();

  return { title, text: trimmedText };
}

async function fetchAllLinks(url) {
  console.log('🕸️  Fetching all links on ' + url);
  // navigate to a page and fetch all of the anchor tags
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);

  console.log("🕸️  Navigating to " + url);

  // wait for body to load
  await page.waitForSelector("body");

  // get all the links and the link text
  const links = await page.$$eval("a", function (elements) {
    return elements.map((element) => {
      return {
        // href: trimHref(element.href),
        href: element.href,
        text: element.textContent,
      };
    })
    // filter out any links that don't have text
    .filter((link) => link.text.length > 0)
    // filter out any links that are internal links by detecting the # symbol
    .filter((link) => !link.href.includes("#"));

  });

  await browser.close();

  // return the links as a newline delimited list prepared for GPT-3
  const linkList = links.map((link) => {
    let linkUrl
    try {
      linkUrl = new URL(link.href);
    } catch (e) {
      // if the URL is invalid, just return the raw link
      return `* ${link.text} (${link.href})`;
    }

    // clear all query params EXCEPT for q=, which is a search query
    linkUrl.search = linkUrl.search
      .split("&")
      .filter((param) => param.startsWith("q="))
      .join("&");

    // return link.text + " (" + linkUrl.href + ") ";

    return `* ${link.text} (${linkUrl.href})`;

    // return link.text + " (" + link.href + ") ";
    // return link.text
  });

  return `# Links on ${url}\n${linkList.join("\n")}`;
}




async function processChunks(chunks, data, limit = 2) {
  const results = [];
  const chunkLength = chunks.length;

  for (let i = 0; i < chunkLength; i += limit) {
    const chunkPromises = chunks.slice(i, i + limit).map(async (chunk, index) => {

      // sleep so we don't anger the OpenAI gods
      await sleep(1000);

      console.log(`📝  Sending chunk ${i + index + 1} of ${chunkLength}...`);
      console.log("📝  Chunk text:", chunk);

      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo-16k",
        max_tokens: 1024,
        temperature: 0.5,
        // presence_penalty: 0.66,
        // presence_penalty: -0.1,
        // frequency_penalty: 0.1,
        messages: [
          // {
          //   role: "assistant",
          //   content: pageUnderstanderPrompt,
          // },
          {
            role: "user",
            content: `${WEBPAGE_UNDERSTANDER_PROMPT}

            ${chunk}      
Remember to be as concise as possible and ignore any links or other text that isn't relevant to the main content of the page.`,
          },
        ],
      });

      return completion.data.choices[0].message.content;
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return results;
}

async function generateSummary(url, data) {
  console.log("📝  Generating summary...");

  // if data.text is longer than 4096 characters, split it into chunks of 4096 characters and send each chunk as a separate message and then combine the responses

  let text = data.text;

  // remove newlines
  text = text.replace(/\n/g, " ");

  // remove tabs
  text = text.replace(/\t/g, " ");

  // remove multiple spaces
  text = text.replace(/ +(?= )/g, "")

  // const chunkAmount = 7000
  const chunkAmount = 13952

  // split the text into chunks of 4096 characters using slice
  // let chunks = [];
  // let chunkStart = 0;
  // let chunkEnd = chunkAmount;
  // while (chunkStart < text.length) {
  //   chunks.push(text.slice(chunkStart, chunkEnd));
  //   chunkStart = chunkEnd;
  //   chunkEnd += chunkAmount;
  // }

  // we need to refactor to use countMessageTokens instead of character count, so we split the text into chunks with chunkAmount tokens each
  let chunks = [];
  let chunkStart = 0;
  // now we need to split the text into chunks of 13592 tokens each
  // so we need to figure out how many tokens are in the text
  // we will use the countMessageTokens function to do this
  let tokenCount = countMessageTokens(text)
  console.log(`📝  Token count: ${tokenCount}`)
  let chunkEnd = chunkAmount; // set the chunkEnd to the chunkAmount so we can start the loop
  while (chunkStart < tokenCount) {
    // we need to make sure that the chunkEnd is not greater than the tokenCount
    if (chunkEnd > tokenCount) {
      chunkEnd = tokenCount
    }
    // now we can push the chunk to the chunks array
    chunks.push(text.slice(chunkStart, chunkEnd));
    // now we can set the chunkStart to the chunkEnd
    chunkStart = chunkEnd;
    // now we can set the chunkEnd to the chunkStart + chunkAmount
    chunkEnd = chunkStart + chunkAmount;
  }

  console.log(`📝  Splitting text into ${chunks.length} chunks...`);
  console.log(`📝  Chunk length: ${chunkAmount} tokens`);

  let factList = "";
  try {
    const chunkResponses = await processChunks(
      chunks,
      data
    );

    factList = chunkResponses.join('\n');

    // return chunkResponses;
  } catch (error) {
    console.log(error);
    return error;
  }

  console.log("📝  Generated summary.");
  console.log("📝  Summary:", factList.split('\n').length);

  // const fileName = `${url.split("/").pop()}`
  // fs.writeFileSync(`./summaries/${fileName}_summary.txt`, factList);

  // summarizing does not seem to help much, so just return the fact list
  return factList
}

function main() {
  const url = process.argv[2];

  fetchAndParseURL(url).then(async (data) => {
    // console.log(JSON.stringify(data, null, 2));

    return generateSummary(url, data);
  });
}

async function fetchAndSummarizeUrl(url) {
  console.log(`📝  Fetching URL: ${url}`);
  const data = await fetchAndParseURL(url);
  console.log(`📝  Fetched URL: ${url}`);
  const summary = await generateSummary(url, data);
  console.log(`📝  Generated summary for URL: ${url}`, summary);
  return summary;
}


// check if this is being run as a script or imported as a module
if (require.main === module) {
  // if this is being run as a script, run the main function
  main();
} else {
  // if this is being imported as a module, export the functions
  module.exports = {
    fetchAndSummarizeUrl,
    fetchAllLinks
  };
}

function countMessageTokens(messageArray = []) {
  let totalTokens = 0;
  // console.log("Message Array: ", messageArray);
  if (!messageArray) {
    return totalTokens;
  }
  if (messageArray.length === 0) {
    return totalTokens;
  }

  // for some reason we get messageArray.forEach is not a function
  // when we try to use the forEach method on messageArray
  // so we use a for loop instead

  // messageArray.forEach((message) => {
  //   // encode message.content
  //   const encodedMessage = encode(JSON.stringify(message));
  //   totalTokens += encodedMessage.length;
  // });

  // for loop
  for (let i = 0; i < messageArray.length; i++) {
    const message = messageArray[i];
    // encode message.content
    const encodedMessage = encode(JSON.stringify(message));
    totalTokens += encodedMessage.length;
  }

  return totalTokens;
}