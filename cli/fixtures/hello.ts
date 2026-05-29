export default {
  async fetch(request) {
    return {
      status: 200,
      body: "hello world",
      headers: { "content-type": "text/plain" },
    };
  },
};
