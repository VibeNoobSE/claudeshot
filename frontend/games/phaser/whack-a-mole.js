registerGame("whack-a-mole", "🔨 Whack-a-Mole", "Click moles to whack them!", "Most whacks in 20 seconds wins", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2a1a0a");
    this.holes=[];this.s1=0;this.s2=0;
    const positions=[[W/4,150],[W/2,150],[W*3/4,150],[W/4,300],[W/2,300],[W*3/4,300],[W/4,420],[W/2,420],[W*3/4,420]];
    positions.forEach(([x,y],i)=>{
      const hole=this.add.circle(x,y,30,0x553311).setStrokeStyle(2,0x332200);
      const mole=this.add.circle(x,y,22,0x884422).setInteractive().setVisible(false);
      mole.on("pointerdown",(ptr)=>{if(!mole.visible)return;
        const who=ptr.x<W/2?"P1":"P2";if(who==="P1")this.s1++;else this.s2++;
        mole.setVisible(false);this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);});
      this.holes.push({hole,mole});
    });
    this.add.rectangle(W/2,H/2,2,H,0x333322);
    this.add.text(W/4,30,"P1 (left)",{fontSize:"14px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.text(W*3/4,30,"P2 (right)",{fontSize:"14px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);
    this.sTxt=this.add.text(W/2,60,"P1: 0 | P2: 0",{fontSize:"20px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.timeLeft=20;
    this.timeTxt=this.add.text(W/2,H-20,this.timeLeft+"s",{fontSize:"16px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){
      this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
      this.timeTxt.setText(this.timeLeft+"s");},loop:true});
    this.time.addEvent({delay:600,callback:()=>{
      this.holes.forEach(h=>h.mole.setVisible(false));
      const active=Phaser.Utils.Array.Shuffle([...this.holes]).slice(0,3);
      active.forEach(h=>{h.mole.setVisible(true);this.time.delayedCall(Phaser.Math.Between(400,1200),()=>h.mole.setVisible(false));});
    },loop:true});
  }
  update(){}
});
