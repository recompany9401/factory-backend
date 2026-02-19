import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendVerificationEmail(to: string, code: string) {
  console.log(`=========================================`);
  console.log(`[이메일 발송 테스트] 수신자: ${to} / 인증번호: ${code}`);
  console.log(`=========================================`);

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(
      "⚠️ 메일 환경변수(EMAIL_USER, EMAIL_PASS)가 설정되지 않아 실제 메일은 발송되지 않습니다.",
    );
    return;
  }

  try {
    await transporter.sendMail({
      from: '"ReCompany" <noreply@recompany.com>',
      to,
      subject: "[리컴퍼니] 회원가입 인증번호 안내",
      text: `인증번호는 [${code}] 입니다. 5분 안에 입력해주세요.`,
    });
    console.log(`메일 발송 성공: ${to}`);
  } catch (error) {
    console.error("메일 발송 실패:", error);
  }
}

export async function sendEmail(to: string, subject: string, text: string) {
  console.log(`=========================================`);
  console.log(`[메일 발송] To: ${to}`);
  console.log(`[제목] ${subject}`);
  console.log(`[내용] ${text}`);
  console.log(`=========================================`);

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return;
  }

  try {
    await transporter.sendMail({
      from: '"ReCompany" <noreply@recompany.com>',
      to,
      subject,
      text,
    });
    console.log(`메일 전송 성공: ${to}`);
  } catch (error) {
    console.error("메일 전송 실패:", error);
  }
}
