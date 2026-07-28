import { getCalendarPostsData } from "../../api/calendar-data.json";

export async function GET() {
	const allPostsData = await getCalendarPostsData("en");

	return new Response(JSON.stringify(allPostsData), {
		headers: {
			"Content-Type": "application/json",
		},
	});
}
