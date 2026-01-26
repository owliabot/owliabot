// workspace/skills/crypto-price/index.js

export const tools = {
  get_price: async ({ coin, currency = "usd" }, context) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=${encodeURIComponent(currency)}`;

    try {
      const res = await context.fetch(url);

      if (!res.ok) {
        return {
          success: false,
          error: `CoinGecko API error: ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();

      if (!data[coin]) {
        return {
          success: false,
          error: `Coin not found: ${coin}. Try common IDs like 'bitcoin', 'ethereum', 'solana'.`,
        };
      }

      const price = data[coin][currency];
      if (price === undefined) {
        return {
          success: false,
          error: `Currency not supported: ${currency}. Try 'usd', 'eur', 'btc'.`,
        };
      }

      return {
        success: true,
        data: {
          coin,
          currency,
          price,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch price: ${err.message}`,
      };
    }
  },
};
