const auditBtn = document.getElementById("auditBtn");

const results = document.getElementById("results");

auditBtn.addEventListener("click", async () => {
  results.innerHTML = "<p>Running Audit...</p>";

  try {
    const response = await fetch("/assets");

    const data = await response.json();

    const assets = data.assets;

    // Filter missing alt text
    const missingAlt = assets.filter((asset) => !asset.altText);

    // Clear loading
    results.innerHTML = "";

    // Show total
    results.innerHTML += `
      <h2>
        ❌ Missing Alt Text (${missingAlt.length})
      </h2>
    `;

    // Create cards
    missingAlt.forEach((asset) => {
      results.innerHTML += `
  <div class="card">

    <img src="${asset.hostedUrl}" />

    <h3>${asset.displayName}</h3>

    <p>Missing alt text</p>

    <input
      type="text"
      placeholder="Enter alt text"
      id="input-${asset.id}"
    />

    <button onclick="saveAltText('${asset.id}')">
      Save
    </button>

  </div>
`;
    });
  } catch (error) {
    console.log(error);

    results.innerHTML = `
      <p>Error running audit</p>
    `;
  }
});

async function saveAltText(assetId) {
  const input = document.getElementById(`input-${assetId}`);

  const altText = input.value;

  if (!altText) {
    alert("Please enter alt text");
    return;
  }

  try {
    const response = await fetch("/update-alt", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        assetId,
        altText,
      }),
    });

    const data = await response.json();

    alert(data.message);
  } catch (error) {
    console.log(error);

    alert("Error updating alt text");
  }
}



generateBtn.addEventListener('click', async () => {

  const cards = document.querySelectorAll('.card');

  for (const card of cards) {

    const fileName =
      card.querySelector('h3').innerText;

    const input =
      card.querySelector('input');

    input.value = 'Generating...';

    try {

      const response = await fetch('/generate-alt', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          fileName
        })
      });

      const data = await response.json();

      input.value = data.altText;

    } catch (error) {

      console.log(error);

      input.value = 'Error generating';

    }

  }

});