import { brand } from "@/lib/branding";

interface BookingEmailData {
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  dateFormatted: string;
  timeFormatted: string;
  timeZone: string;
  durationMinutes: number;
  meetingUrl?: string | null;
  hostName?: string;
  answers?: { label: string; value: string }[];
}

function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background-color:${brand.colors.surface};color:${brand.colors.ink};">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background-color:${brand.colors.primary};width:40px;height:40px;border-radius:50%;text-align:center;line-height:40px;color:#fff;font-weight:bold;font-size:18px;">O</div>
      <p style="margin:8px 0 0;font-size:16px;font-weight:600;color:${brand.colors.ink};">${brand.productName}</p>
    </div>
    <div style="background:#ffffff;border:1px solid ${brand.colors.border};border-radius:16px;padding:32px;">
      ${content}
    </div>
    <div style="text-align:center;margin-top:32px;font-size:12px;color:${brand.colors.inkMuted};">
      <p>${brand.legalName}</p>
      <p><a href="${brand.websiteUrl}" style="color:${brand.colors.primary};text-decoration:none;">${brand.websiteUrl.replace("https://", "")}</a></p>
      <p style="margin-top:8px;">This email was sent by ${brand.productName}.</p>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildConfirmationEmail(data: BookingEmailData) {
  const answersHtml = data.answers && data.answers.length > 0
    ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid ${brand.colors.border};"><p style="font-size:13px;font-weight:600;color:${brand.colors.inkMuted};margin:0 0 8px;">Your responses</p>${data.answers.map((a) => `<p style="font-size:14px;margin:4px 0;"><span style="color:${brand.colors.inkMuted};">${a.label}:</span> ${a.value}</p>`).join("")}</div>` : "";
  const meetingLink = data.meetingUrl
    ? `<p style="margin-top:16px;"><a href="${data.meetingUrl}" style="display:inline-block;background-color:${brand.colors.primary};color:#ffffff;padding:10px 24px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">Join meeting</a></p>` : "";
  const html = emailWrapper(`
    <h1 style="font-size:20px;font-weight:600;margin:0 0 4px;">You're booked!</h1>
    <p style="font-size:14px;color:${brand.colors.inkMuted};margin:0 0 24px;">Your ${data.eventTitle} with ${brand.name} is confirmed.</p>
    <div style="background:${brand.colors.surface};border-radius:12px;padding:16px;">
      <p style="margin:0;font-size:15px;font-weight:600;">${data.dateFormatted}</p>
      <p style="margin:4px 0 0;font-size:14px;color:${brand.colors.inkMuted};">${data.timeFormatted} · ${data.durationMinutes} min · ${data.timeZone}</p>
      ${data.hostName ? `<p style="margin:4px 0 0;font-size:14px;color:${brand.colors.inkMuted};">with ${data.hostName}</p>` : ""}
    </div>
    ${meetingLink}
    ${answersHtml}
    <p style="margin-top:24px;font-size:13px;color:${brand.colors.inkMuted};">Need to reschedule or cancel? Reply to this email and we'll take care of it.</p>
  `);
  return {
    subject: `Confirmed: ${data.eventTitle} — ${data.dateFormatted}`,
    html,
    text: `Your ${data.eventTitle} with ${brand.name} is confirmed.\n\n${data.dateFormatted}\n${data.timeFormatted} · ${data.durationMinutes} min · ${data.timeZone}\n${data.meetingUrl ? `\nJoin: ${data.meetingUrl}` : ""}\n\nNeed to reschedule? Reply to this email.`,
  };
}

export function buildReminderEmail(data: BookingEmailData) {
  const html = emailWrapper(`
    <h1 style="font-size:20px;font-weight:600;margin:0 0 4px;">Reminder: ${data.eventTitle}</h1>
    <p style="font-size:14px;color:${brand.colors.inkMuted};margin:0 0 24px;">Your meeting with ${brand.name} is coming up.</p>
    <div style="background:${brand.colors.surface};border-radius:12px;padding:16px;">
      <p style="margin:0;font-size:15px;font-weight:600;">${data.dateFormatted}</p>
      <p style="margin:4px 0 0;font-size:14px;color:${brand.colors.inkMuted};">${data.timeFormatted} · ${data.durationMinutes} min · ${data.timeZone}</p>
    </div>
    ${data.meetingUrl ? `<p style="margin-top:16px;"><a href="${data.meetingUrl}" style="display:inline-block;background-color:${brand.colors.primary};color:#ffffff;padding:10px 24px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">Join meeting</a></p>` : ""}
    <p style="margin-top:24px;font-size:13px;color:${brand.colors.inkMuted};">Can't make it? Reply to this email to reschedule or cancel.</p>
  `);
  return {
    subject: `Reminder: ${data.eventTitle} — ${data.dateFormatted}`,
    html,
    text: `Reminder: Your ${data.eventTitle} with ${brand.name} is tomorrow.\n\n${data.dateFormatted} at ${data.timeFormatted}\n${data.meetingUrl ? `Join: ${data.meetingUrl}` : ""}\n\nCan't make it? Reply to reschedule.`,
  };
}

export function buildCancellationEmail(data: Pick<BookingEmailData, "guestName" | "eventTitle" | "dateFormatted" | "timeFormatted">, reason?: string) {
  const html = emailWrapper(`
    <h1 style="font-size:20px;font-weight:600;margin:0 0 4px;">Meeting cancelled</h1>
    <p style="font-size:14px;color:${brand.colors.inkMuted};margin:0 0 24px;">Your ${data.eventTitle} has been cancelled.</p>
    <div style="background:${brand.colors.surface};border-radius:12px;padding:16px;">
      <p style="margin:0;font-size:15px;font-weight:600;text-decoration:line-through;color:${brand.colors.inkMuted};">${data.dateFormatted} at ${data.timeFormatted}</p>
    </div>
    ${reason ? `<p style="margin-top:16px;font-size:14px;"><strong>Reason:</strong> ${reason}</p>` : ""}
    <p style="margin-top:24px;font-size:14px;">Want to rebook? <a href="${brand.appUrl}/book" style="color:${brand.colors.primary};font-weight:600;text-decoration:none;">Schedule a new time →</a></p>
  `);
  return {
    subject: `Cancelled: ${data.eventTitle} — ${data.dateFormatted}`,
    html,
    text: `Your ${data.eventTitle} on ${data.dateFormatted} at ${data.timeFormatted} has been cancelled.${reason ? ` Reason: ${reason}` : ""}\n\nWant to rebook? Visit ${brand.appUrl}/book`,
  };
}

export function buildHostNotificationEmail(data: BookingEmailData) {
  const answersText = data.answers && data.answers.length > 0
    ? data.answers.map((a) => `<p style="font-size:14px;margin:4px 0;"><span style="color:${brand.colors.inkMuted};">${a.label}:</span> ${a.value}</p>`).join("")
    : "";
  const html = emailWrapper(`
    <h1 style="font-size:20px;font-weight:600;margin:0 0 4px;">New booking!</h1>
    <p style="font-size:14px;color:${brand.colors.inkMuted};margin:0 0 24px;">${data.guestName} (${data.guestEmail}) booked a ${data.eventTitle}.</p>
    <div style="background:${brand.colors.surface};border-radius:12px;padding:16px;">
      <p style="margin:0;font-size:15px;font-weight:600;">${data.dateFormatted}</p>
      <p style="margin:4px 0 0;font-size:14px;color:${brand.colors.inkMuted};">${data.timeFormatted} · ${data.durationMinutes} min · ${data.timeZone}</p>
    </div>
    ${answersText ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid ${brand.colors.border};">${answersText}</div>` : ""}
  `);
  return {
    subject: `New booking: ${data.guestName} — ${data.eventTitle}`,
    html,
    text: `New booking: ${data.guestName} (${data.guestEmail}) booked a ${data.eventTitle} on ${data.dateFormatted} at ${data.timeFormatted}.`,
  };
}
