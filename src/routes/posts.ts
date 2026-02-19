import { Router } from "express";
import { prisma } from "../db/prisma";
import { PostType } from "@prisma/client";

const router = Router();

// 목록 조회
router.get("/", async (req, res) => {
  try {
    const { section } = req.query;

    let targetTypes: PostType[] = [];

    if (section === "news") {
      targetTypes = ["NOTICE", "PRESS"];
    } else {
      targetTypes = ["GOV_SUPPORT", "POLICY"];
    }

    const posts = await prisma.post.findMany({
      where: {
        status: "PUBLISHED",
        type: { in: targetTypes },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        title: true,
        thumbnailUrl: true,
        createdAt: true,
      },
    });

    res.json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "게시글 목록을 불러오지 못했습니다." });
  }
});

// 상세 조회
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
    });

    if (!post) {
      return res.status(404).json({ message: "게시글을 찾을 수 없습니다." });
    }

    const isNewsGroup = (["NOTICE", "PRESS"] as PostType[]).includes(post.type);

    const targetTypes: PostType[] = isNewsGroup
      ? ["NOTICE", "PRESS"]
      : ["GOV_SUPPORT", "POLICY"];

    const prevPost = await prisma.post.findFirst({
      where: {
        createdAt: { lt: post.createdAt },
        status: "PUBLISHED",
        type: { in: targetTypes },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    });

    const nextPost = await prisma.post.findFirst({
      where: {
        createdAt: { gt: post.createdAt },
        status: "PUBLISHED",
        type: { in: targetTypes },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true },
    });

    res.json({ ...post, prevPost, nextPost });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "게시글 상세 정보를 불러오지 못했습니다." });
  }
});

export default router;
