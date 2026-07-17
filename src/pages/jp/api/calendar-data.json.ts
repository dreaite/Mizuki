import { setCurrentLocaleContext } from "../../../i18n/locale";
import { getCalendarPostsData } from "../../api/calendar-data.json";

export async function GET() {
	setCurrentLocaleContext("jp", true);
	const allPostsData = await getCalendarPostsData("ja");

	return new Response(JSON.stringify(allPostsData), {
		headers: {
			"Content-Type": "application/json",
		},
	});
}
