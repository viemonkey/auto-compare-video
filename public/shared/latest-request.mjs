// Chống race cho các lệnh gọi API theo từng dòng: chỉ kết quả của yêu cầu MỚI NHẤT được dùng.
// - mỗi yêu cầu có requestId tăng dần + AbortController; gửi yêu cầu mới thì huỷ yêu cầu cũ (fetch nhận signal);
// - kết quả của yêu cầu đã bị thay thế (kể cả khi đã về tới nơi) trả STALE để caller bỏ qua, không ghi đè dữ liệu mới.
export const STALE = Symbol("stale-request");

export function createLatestRunner() {
  let seq = 0;
  let controller = null;
  return {
    /** Có yêu cầu đang chờ không. */
    get pending() {
      return controller !== null;
    },
    /**
     * Chạy `fn(signal, requestId)`; huỷ yêu cầu trước đó. Trả kết quả của fn, hoặc STALE nếu đã bị yêu cầu mới hơn / cancel() thay thế.
     * Lỗi của yêu cầu đã bị thay thế cũng bị nuốt (trả STALE) — lỗi thật của yêu cầu mới nhất vẫn được ném.
     */
    async run(fn) {
      if (controller) controller.abort();
      const mine = new AbortController();
      controller = mine;
      const id = ++seq;
      try {
        const result = await fn(mine.signal, id);
        return id === seq ? result : STALE;
      } catch (err) {
        if (id !== seq || mine.signal.aborted) return STALE;
        throw err;
      } finally {
        if (id === seq) controller = null;
      }
    },
    /** Huỷ yêu cầu đang chờ (nếu có) và bỏ qua kết quả của nó. */
    cancel() {
      if (controller) controller.abort();
      controller = null;
      seq++;
    },
  };
}
