export default {
  async fetch() {
    return {
      status: 200,
      body: JSON.stringify({
        secret: process.env.API_KEY,
      }),
      headers: { "content-type": "application/json" },
    };
  },
};
