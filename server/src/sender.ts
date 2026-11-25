/** Отправка кода входа. Настоящий сервис звонков подключим, когда будет договор (открытый вопрос №2). */
export interface CodeSender {
  send(phone: string, code: string): Promise<void>;
}

/** Только для разработки: печатает код в лог. В production не запускается (см. server.ts). */
export class ConsoleSender implements CodeSender {
  async send(phone: string, code: string): Promise<void> {
    console.log(`[код входа] ${phone}: ${code}`);
  }
}
