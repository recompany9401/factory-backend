import axios from "axios";

export async function validateBusinessNumber(
  businessNumber: string,
): Promise<boolean> {
  const API_KEY = process.env.PUBLIC_DATA_PORTAL_KEY;
  const API_URL = "https://api.odcloud.kr/api/nts-businessman/v1/status";

  if (!API_KEY) {
    console.warn("공공데이터 포털 키가 없습니다. 사업자 인증을 건너뜁니다.");
    return true;
  }

  try {
    const cleanNumber = businessNumber.replace(/-/g, "");

    const response = await axios.post(`${API_URL}?serviceKey=${API_KEY}`, {
      b_no: [cleanNumber],
    });

    const data = response.data;
    if (data && data.data && data.data.length > 0) {
      const taxType = data.data[0].b_stt_cd;
      return taxType !== "";
    }
    return false;
  } catch (error) {
    console.error("사업자 조회 에러:", error);
    return false;
  }
}
