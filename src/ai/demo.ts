// Demo mode: realistic canned responses for development and trying the app without a key.
// Every result produced here is labeled "Demo" in the UI and is never shown as live AI.
import type { BreakdownResult } from './schemas';

interface Fixture {
  match: RegExp;
  result: BreakdownResult;
}

const TIME_QUESTION = {
  text: 'How much time do you have?',
  options: ['5 minutes', '15 minutes', '30 minutes or more'],
};

const FIXTURES: Fixture[] = [
  {
    match: /kitchen|dishes/i,
    result: {
      steps: [
        { text: 'Put three dishes in the sink', tier: 'required', estimateMin: 1 },
        { text: 'Throw away any trash on the counter', tier: 'required', estimateMin: 2 },
        { text: 'Load or wash the dishes in the sink', tier: 'required', estimateMin: 10 },
        { text: 'Wipe the counter next to the stove', tier: 'required', estimateMin: 3 },
        { text: 'Take out the kitchen trash', tier: 'optional', estimateMin: 3 },
        { text: 'Sweep the floor', tier: 'optional', estimateMin: 5 },
      ],
      firstStepIndex: 0,
      question: TIME_QUESTION,
    },
  },
  {
    match: /email|inbox|reply|message/i,
    result: {
      steps: [
        {
          text: 'Open your inbox and find the one message that matters most',
          tier: 'required',
          estimateMin: 2,
        },
        { text: 'Write a two-sentence reply, rough is fine', tier: 'required', estimateMin: 3 },
        { text: 'Read it once and press send', tier: 'required', estimateMin: 1 },
        { text: 'Archive five messages you no longer need', tier: 'optional', estimateMin: 3 },
      ],
      firstStepIndex: 0,
    },
  },
  {
    match: /report|essay|write|paper|draft/i,
    result: {
      steps: [
        { text: 'Open a blank document and type the title', tier: 'required', estimateMin: 1 },
        {
          text: 'Write three bullet points of what it needs to say',
          tier: 'required',
          estimateMin: 5,
        },
        { text: 'Turn the first bullet into a rough paragraph', tier: 'required', estimateMin: 10 },
        { text: 'Do the same for the other two bullets', tier: 'required', estimateMin: 15 },
        {
          text: 'Read it through once and fix anything confusing',
          tier: 'optional',
          estimateMin: 10,
        },
      ],
      firstStepIndex: 0,
      question: {
        text: 'What kind of version do you need?',
        options: ['Quick rough draft', 'Polished final'],
      },
    },
  },
  {
    match: /laundry|clothes/i,
    result: {
      steps: [
        {
          text: 'Pick up five pieces of clothing and put them in the basket',
          tier: 'required',
          estimateMin: 2,
        },
        { text: 'Carry the basket to the washer', tier: 'required', estimateMin: 1 },
        { text: 'Start a load', tier: 'required', estimateMin: 3 },
        { text: 'Set a timer for when it finishes', tier: 'optional', estimateMin: 1 },
      ],
      firstStepIndex: 0,
    },
  },
];

function generic(title: string): BreakdownResult {
  const t = title.length > 50 ? `${title.slice(0, 49)}…` : title;
  return {
    steps: [
      { text: `Write down what "done" looks like for ${t}`, tier: 'required', estimateMin: 2 },
      { text: 'Gather the one thing you need to begin', tier: 'required', estimateMin: 2 },
      { text: 'Do the first small piece for five minutes', tier: 'required', estimateMin: 5 },
      { text: 'Decide the next small piece', tier: 'required', estimateMin: 1 },
      { text: 'Tidy up and note where you stopped', tier: 'optional', estimateMin: 2 },
    ],
    firstStepIndex: 1,
    question: TIME_QUESTION,
  };
}

export function demoBreakdown(title: string): BreakdownResult {
  const hit = FIXTURES.find((f) => f.match.test(title));
  const result = hit ? hit.result : generic(title);
  const { question, ...rest } = result;
  return question ? { ...rest, question } : rest;
}

export function demoEasier(text: string): string {
  return `Just take the first tiny bit: ${text.charAt(0).toLowerCase()}${text.slice(1)}, for one minute`;
}
