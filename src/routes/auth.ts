import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { signAccessToken } from "../utils/jwt";
import { validateBusinessNumber } from "../utils/businessApi";
import { sendVerificationEmail } from "../utils/mailer";
import { authenticateToken, AuthRequest } from "../middlewares/auth";

const router = Router();

router.post("/send-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return res
      .status(409)
      .json({ message: "이미 가입된 이메일입니다. 로그인을 해주세요." });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.verificationCode.upsert({
    where: { email },
    update: { code, expiresAt },
    create: { email, code, expiresAt },
  });

  try {
    await sendVerificationEmail(email, code);
    return res.json({ message: "Verification code sent" });
  } catch (e) {
    return res.status(500).json({ message: "Failed to send email" });
  }
});

const signupSchema = z.object({
  email: z.string().email(),
  verificationCode: z.string().min(6, "인증번호를 입력해주세요"),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다"),
  name: z.string().min(1, "이름을 입력해주세요"),
  phone: z.string().optional(),
  userType: z.enum(["PERSONAL", "BUSINESS"]).default("PERSONAL"),
  companyName: z.string().optional(),
  businessNumber: z.string().optional(),
  representativeName: z.string().optional(),
  companyAddress: z.string().optional(),
  businessType: z.string().optional(),
  businessItem: z.string().optional(),
});

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "입력값이 올바르지 않습니다",
      issues: parsed.error.issues,
    });
  }

  const body = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists)
    return res.status(409).json({ message: "이미 가입된 이메일입니다." });

  const verifyRecord = await prisma.verificationCode.findUnique({
    where: { email: body.email },
  });
  if (!verifyRecord) {
    return res.status(400).json({ message: "인증번호를 먼저 요청해주세요." });
  }
  if (verifyRecord.code !== body.verificationCode) {
    return res.status(400).json({ message: "인증번호가 일치하지 않습니다." });
  }
  if (verifyRecord.expiresAt < new Date()) {
    return res.status(400).json({ message: "인증번호가 만료되었습니다." });
  }

  if (body.userType === "BUSINESS") {
    if (!body.companyName || !body.businessNumber) {
      return res
        .status(400)
        .json({ message: "사업자명과 사업자번호는 필수입니다." });
    }

    const isValidBiz = await validateBusinessNumber(body.businessNumber);
    if (!isValidBiz) {
      return res
        .status(400)
        .json({ message: "유효하지 않은 사업자번호입니다." });
    }
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash,
      name: body.name,
      phone: body.phone,
      userType: body.userType,
      companyName: body.userType === "BUSINESS" ? body.companyName : null,
      businessNumber: body.userType === "BUSINESS" ? body.businessNumber : null,
      representativeName:
        body.userType === "BUSINESS" ? body.representativeName : null,
      companyAddress: body.userType === "BUSINESS" ? body.companyAddress : null,
      businessType: body.userType === "BUSINESS" ? body.businessType : null,
      businessItem: body.userType === "BUSINESS" ? body.businessItem : null,
    },
  });

  await prisma.verificationCode.delete({ where: { email: body.email } });

  const token = signAccessToken({ userId: user.id, role: user.userRole });
  return res.status(201).json({ token, user });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const { identity, password } = req.body;

  if (!identity || !password) {
    return res
      .status(400)
      .json({ message: "아이디(이메일)와 비밀번호를 모두 입력해주세요." });
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identity }, { loginId: identity }],
      },
    });

    if (!user) {
      return res
        .status(401)
        .json({ message: "아이디(이메일) 또는 비밀번호가 틀렸습니다." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res
        .status(401)
        .json({ message: "아이디(이메일) 또는 비밀번호가 틀렸습니다." });
    }

    const token = signAccessToken({
      userId: user.id,
      role: user.userRole,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        loginId: user.loginId,
        name: user.name,
        phone: user.phone,
        userType: user.userType,
        userRole: user.userRole,
        companyName: user.companyName,
      },
    });
  } catch (error) {
    console.error("로그인 처리 중 서버 에러:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        userType: true,
        companyName: true,
        userRole: true,
      },
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch user info" });
  }
});

router.patch("/me", authenticateToken, async (req: AuthRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "입력값이 올바르지 않습니다.",
      issues: parsed.error.issues,
    });
  }

  const { name, phone, companyName, currentPassword, newPassword } =
    parsed.data;
  const userId = req.user!.userId;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
      return res.status(404).json({ message: "유저를 찾을 수 없습니다." });

    let hashedNewPassword = undefined;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          message: "비밀번호를 변경하려면 현재 비밀번호가 필요합니다.",
        });
      }
      const match = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!match) {
        return res
          .status(403)
          .json({ message: "현재 비밀번호가 일치하지 않습니다." });
      }
      hashedNewPassword = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name ?? undefined,
        phone: phone ?? undefined,
        companyName: companyName ?? undefined,
        passwordHash: hashedNewPassword ?? undefined,
      },
      select: {
        id: true,
        email: true,
        name: true,
        userType: true,
        companyName: true,
        phone: true,
      },
    });

    res.json({ message: "정보가 수정되었습니다.", user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "정보 수정 중 오류가 발생했습니다." });
  }
});

router.delete("/me", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  try {
    await prisma.user.delete({
      where: { id: userId },
    });

    res.json({ message: "회원 탈퇴가 완료되었습니다." });
  } catch (error) {
    console.error("회원 탈퇴 실패:", error);
    res.status(500).json({ message: "회원 탈퇴 중 오류가 발생했습니다." });
  }
});

export default router;
