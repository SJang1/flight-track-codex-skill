export function streamResponse(contentType, serialize, produce) {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(stream) {
      const send = (message) => {
        if (!controller.signal.aborted) stream.enqueue(encoder.encode(serialize(message)));
      };
      void produce(send, controller.signal).then(
        () => { if (!controller.signal.aborted) stream.close(); },
        (error) => { if (!controller.signal.aborted) stream.error(error); },
      );
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
