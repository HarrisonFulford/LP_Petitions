# LP_Petitions – Theshold Based Liquidity Commitments
> Commit liquidity before a pool exists, then automatically enter once enough others are ready too.

## The Problem 

Some people want to LP for a pool, but only if the pool is large enough to be worth joining. 

Today, there is no clean way to say: 

> “I’ll provide liquidity, but only once enough other people commit too.” 

This makes liquidity formation hard for new, small, or nonexistent pools without centralized providers jumpstarting it with a huge volume at once.

Stats: **TBD** 

## The Solution 

LP Petitions lets users sign conditional LP commitments. A user chooses a token pair, sets how much liquidity they are willing to provide, and picks a minimum TVL threshold. Their liquidity only activates once enough compatible commitments exist. 

For concentrated liquidity, users can also choose an aggressiveness level, which determines how tight their LP range is around the current token ratio. 

Technical execution details: **TBD** 

You only become an LP if the conditions you agreed to are met.

## Track Specifications / Requirements:

### Uniswap:

Build with the Uniswap API to access liquidity and execute value onchain.

Projects must integrate the Uniswap API with a valid API key from the Uniswap Developer Platform for core functionality such as trade execution, routing, payments, liquidity provision or coordination between agents or systems. This may include trading applications, agent-based systems, automated strategies, or new financial primitives, leveraging Uniswap’s permissionless liquidity and emerging capabilities such as AI-driven systems.

Qualification Requirements
Each team must submit:

Transaction IDs demonstrating real onchain execution (testnet and/or mainnet)
A public GitHub repository with open-source code and a clear README.md
A demo video (maximum 3 minutes)
A completed submission to the Uniswap Developer Feedback Form: https://developers.uniswap.org/docs?form=feedback

### Chainlink:

Build something awesome using Chainlink! Specifically using CCIP, Price Feeds, Data Streams, PoR or VRF.

Note: Please use CRE instead of using Chainlink Functions or Automation. These products will be deprecated, and any project that needs this type of functionality should use CRE instead.

Qualification Requirements
📍Requirements:

Each project must use a Chainlink service in some form to make a state change on a blockchain, otherwise it will not be eligible for the Chainlink core prizes. This means that a front end simply reading from Chainlink Data Feeds doesn't count. Using Chainlink inside your smart contracts is required.

While all project submissions are evaluated holistically, there will be bonus points given to projects that use multiple Chainlink services in a meaningful way.

Please let us know how you use Chainlink in the project description.
