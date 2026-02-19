import { prisma } from "../db/prisma";
import { sendEmail } from "./mailer";

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  sendMail: boolean = false,
) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
      },
      include: {
        user: true,
      },
    });

    if (sendMail && notification.user.email) {
      await sendEmail(notification.user.email, `[리컴퍼니] ${title}`, message);
    }

    return notification;
  } catch (error) {
    console.error("알림 생성 실패:", error);
  }
}
