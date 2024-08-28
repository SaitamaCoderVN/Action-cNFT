import express from "express";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsInstruction,
  toWeb3JsKeypair,
  toWeb3JsTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";

import { mplTokenMetadata, createNft } from '@metaplex-foundation/mpl-token-metadata';
import { mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine';

import { 
  createPostResponse, 
  actionCorsMiddleware, 
  ACTIONS_CORS_HEADERS
} from "@solana/actions";
import { createUmi, keypairIdentity, generateSigner, percentAmount } from '@metaplex-foundation/umi';

const DEFAULT_SOL_ADDRESS = Keypair.generate().publicKey;
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;

// Express app setup
const app = express();
app.use(express.json());

app.use(actionCorsMiddleware());

// Routes
app.get("/actions.json", getActionsJson);
app.get("/api/actions/mint-nft-dispenser", getTransferSol);
app.post("/api/actions/mint-nft-dispenser", postTransferSol);

// Route handlers
function getActionsJson(req, res) {
  const payload = {
    rules: [
      { pathPattern: "/*", apiPath: "/api/actions/*" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  };
  res.json(payload);
}

async function getTransferSol(req, res) {
  try {
    const { toPubkey } = validatedQueryParams(req.query);
    const baseHref = `${BASE_URL}/api/actions/mint-nft-dispenser?to=${toPubkey.toBase58()}`;

    const payload = {
      title: "Actions Example - Transfer Native SOL",
      icon: "https://solana-actions.vercel.app/solana_devs.jpg",
      description: "Transfer SOL to another Solana wallet",
      links: {
        actions: [
          { label: "Mint NFT", href: `${baseHref}` },
        ],
      },
    };

    res.json(payload);
  }catch (err) {
    if (err instanceof Error) {
      res.status(500).json({ message: err.message });
    } else {
      res.status(500).json({ message: 'An unknown error occurred' });
    }
  }
}

async function postTransferSol(req, res) {
  try {
    const { toPubkey } = validatedQueryParams(req.query);
    const { account } = req.body;  
    console.log("account", account);

    if (!account) {
      throw new Error('Invalid "account" provided');
    }

    const metadata = {
      name: "My NFT Dispenser", 
      description: "This is a sample NFT dispenser", 
      image: "https://example.com/image.png", 
      external_url: "https://example.com",
      attributes: [], 
      properties: {
        files: [
          {
            uri: "https://example.com/image.png", // Gắn cứng đường dẫn hình ảnh
            type: "image/png",
          },
        ],
        category: "image",
      },
    };

    console.log({ metadata });

    const keypair = Keypair.generate(); // Tạo Keypair mới
    console.log("keypair", keypair)

    const umi = createUmi('https://api.devnet.solana.com')
    .use(mplTokenMetadata())
    .use(keypairIdentity(fromWeb3JsKeypair(keypair)));

    console.log("umi", umi);

    const mint = generateSigner(umi);

    const builder = await createNft(umi, {
      mint,
      name: metadata.name,
      symbol: "ACT",
      uri: "https://example.com/image.png",
      sellerFeeBasisPoints: percentAmount(parseFloat("dispenser.royalty") ?? 0),
      tokenOwner: fromWeb3JsPublicKey(toPubkey),
    });

    const ixs = builder.getInstructions().map(toWeb3JsInstruction);

    const reference = Keypair.generate();

    ixs.forEach((ix) => {
      if (ix.keys.some((key) => key.pubkey.equals(toPubkey))) {
        ix.keys.push({
          pubkey: reference.publicKey,
          isSigner: false,
          isWritable: false,
        });

        ix.keys.push({
          pubkey: toPubkey,
          isSigner: true,
          isWritable: true,
        });
      }
    });

    const transaction = new Transaction().add(...ixs);

    transaction.feePayer = keypair.publicKey; 

    transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;

    console.dir(transaction, { depth: null });

    const payload = await createPostResponse({
      fields: {
        transaction: transaction,
        message: "Claim Success",
      },
      signers: [toWeb3JsKeypair(mint), keypair],
    });

    res.json(payload);
  } catch (err) {
    res.status(400).json({ error: err.message || "An unknown error occurred" });
  }
}

function validatedQueryParams(query) {
  let toPubkey = DEFAULT_SOL_ADDRESS;

  if (query.to) {
    try {
      toPubkey = new PublicKey(query.to);
    } catch (err) {
      throw new Error("Invalid input query parameter: to");
    }
  }

  return { toPubkey };
}

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
