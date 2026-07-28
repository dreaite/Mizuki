import { getCalendarPostsData } from "../../api/calendar-data.json";

export async function GET() {
	const allPostsData = await getCalendarPostsData("zh_CN");

	return new Response(JSON.stringify(allPostsData), {
		headers: {
			"Content-Type": "application/json",
		},
	});
}
